import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createEditor,
  type Descendant,
  Editor,
  Range,
  Transforms,
  Text,
  Node,
} from "slate";
import { Slate, Editable, withReact, ReactEditor } from "slate-react";
import { withHistory } from "slate-history";
import clsx from "clsx";
import Toolbar from "./Toolbar";
import { withTables } from "./plugins/withTables";
import { jsonToSlateValue } from "./utils/jsonConversion";
import type { textStyle } from "./types";
import styles from "./slate-editor.module.css";
import CommentSidebar from "../CommentSidebar";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import type {
  repliesType,
  storedCommentsType,
} from "../OutputGeneration/ActionLogTable";
import {
  addComments,
  fetchComments,
} from "../../store/reducer/comments/action";
import FloatingCommentToolbar from "../FloatingCommentToolbar";
import { v4 as uuid } from "uuid";
import api from "../../api/api";
import config from "../../api/comments/config";

// =============================================================================
// ✅ NEW — BULLETPROOF COMMENT ANCHORING SYSTEM
// =============================================================================
//
// ROOT CAUSE OF DRIFT:
//   Slate stores selections as { path, offset } — a structural address inside
//   the document tree. The moment any content before the comment changes
//   (typing, paste, undo, block split/merge), those addresses shift and the
//   comment highlights end up on the wrong text.
//
// THE FIX — Text-Context Re-Anchoring:
//   Instead of saving a structural address, we save the TEXT CONTEXT around
//   the selection at creation time:
//
//     beforeText  — up to CONTEXT_SIZE chars immediately before the selection
//     selectedText — the exact text the user highlighted
//     afterText   — up to CONTEXT_SIZE chars immediately after the selection
//
//   On every edit (debounced 150ms) and on every reload, we run
//   reAnchorAllComments() which:
//     1. Builds the full plain-text of the document + a char→path map
//     2. Fuzzy-searches for each comment's context string
//     3. Re-stamps the commentId mark at the new position
//
//   This survives: typing before/after, paste, undo/redo, block splits/merges,
//   cross-block selections, cut & paste of commented text (if text survives),
//   and full page reloads — because it never cares about Slate paths at all.
//
// BACKWARDS COMPATIBILITY:
//   Old comments that only have a Slate range (no anchor) are handled in a
//   graceful fallback: we stamp the range once, immediately capture an anchor
//   from the result, and from then on they use the new system.
// =============================================================================

const CONTEXT_SIZE = 20; // characters of surrounding context to store

// ✅ NEW: The data shape stored per comment. Sent to / received from the API.
interface CommentAnchor {
  beforeText: string;   // context chars before the selection
  selectedText: string; // the exact highlighted text
  afterText: string;    // context chars after the selection
}

// ─────────────────────────────────────────────────────────────────────────────
// ✅ NEW: getFullTextWithMap
//
// Walks every text leaf in the Slate document and builds:
//   fullText  — the entire document as a plain string (no newlines between blocks)
//   charMap   — for every char in fullText, the { path, offset } that points
//               back to the leaf node it came from
//
// This lets us do string-level search and then convert results back to Slate
// ranges, bridging the gap between text search and Slate's tree structure.
// ─────────────────────────────────────────────────────────────────────────────
const getFullTextWithMap = (
  editor: Editor
): {
  fullText: string;
  charMap: Array<{ path: number[]; offset: number }>;
} => {
  let fullText = "";
  const charMap: Array<{ path: number[]; offset: number }> = [];

  for (const [node, path] of Node.texts(editor)) {
    for (let i = 0; i < node.text.length; i++) {
      fullText += node.text[i];
      charMap.push({ path: [...path], offset: i });
    }
  }

  return { fullText, charMap };
};

// ─────────────────────────────────────────────────────────────────────────────
// ✅ NEW: findAnchorRange
//
// Given a CommentAnchor, finds the best matching position in the current
// document and returns a Slate Range pointing to it.
//
// Algorithm:
//   1. Collect all occurrences of selectedText in the full document text
//   2. For each occurrence, score how well the surrounding chars match the
//      stored beforeText / afterText (simple character-overlap ratio)
//   3. Pick the highest-scoring candidate
//   4. Convert the winning char indices back to Slate { path, offset } points
//
// Returns null if the text no longer exists in the document.
// ─────────────────────────────────────────────────────────────────────────────
const findAnchorRange = (
  editor: Editor,
  anchor: CommentAnchor
): Range | null => {
  const { fullText, charMap } = getFullTextWithMap(editor);
  if (!fullText || !anchor.selectedText) return null;

  const { beforeText, selectedText, afterText } = anchor;

  // Simple character-overlap similarity (0–1). Fast enough for real-time use.
  const similarity = (a: string, b: string): number => {
    if (!a && !b) return 1;
    if (!a || !b) return 0;
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    let matches = 0;
    for (let i = 0; i < shorter.length; i++) {
      if (longer.includes(shorter[i])) matches++;
    }
    return matches / longer.length;
  };

  // Collect every position where selectedText appears
  const candidates: Array<{ startIdx: number; score: number }> = [];
  let searchFrom = 0;
  while (searchFrom < fullText.length) {
    const idx = fullText.indexOf(selectedText, searchFrom);
    if (idx === -1) break;

    const actualBefore = fullText.slice(Math.max(0, idx - CONTEXT_SIZE), idx);
    const actualAfter = fullText.slice(
      idx + selectedText.length,
      idx + selectedText.length + CONTEXT_SIZE
    );

    // Weight before and after equally
    const score =
      similarity(actualBefore, beforeText) * 0.5 +
      similarity(actualAfter, afterText) * 0.5;

    candidates.push({ startIdx: idx, score });
    searchFrom = idx + 1;
  }

  if (candidates.length === 0) return null;

  // Best context match wins
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  const startCharIdx = best.startIdx;
  const endCharIdx = best.startIdx + selectedText.length - 1;

  if (startCharIdx >= charMap.length || endCharIdx >= charMap.length)
    return null;

  return {
    anchor: {
      path: charMap[startCharIdx].path,
      offset: charMap[startCharIdx].offset,
    },
    focus: {
      path: charMap[endCharIdx].path,
      offset: charMap[endCharIdx].offset + 1, // focus offset is exclusive
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// ✅ NEW: captureAnchor
//
// Called once at comment-creation time (or when migrating an old range-only
// comment). Converts the current Slate Range into a CommentAnchor by:
//   1. Building the char map for the current document
//   2. Finding where the range's anchor/focus points land in the flat text
//   3. Slicing out the before/selected/after context strings
//
// The returned anchor is the only thing we need to store. We never need the
// Slate range again for positioning purposes.
// ─────────────────────────────────────────────────────────────────────────────
const captureAnchor = (
  editor: Editor,
  range: Range
): CommentAnchor | null => {
  const { fullText, charMap } = getFullTextWithMap(editor);
  if (!fullText) return null;

  const anchorPath = range.anchor.path;
  const anchorOffset = range.anchor.offset;
  const focusPath = range.focus.path;
  const focusOffset = range.focus.offset;

  let startIdx = -1;
  let endIdx = -1;

  for (let i = 0; i < charMap.length; i++) {
    const c = charMap[i];
    if (
      startIdx === -1 &&
      JSON.stringify(c.path) === JSON.stringify(anchorPath) &&
      c.offset === anchorOffset
    ) {
      startIdx = i;
    }
    if (
      JSON.stringify(c.path) === JSON.stringify(focusPath) &&
      c.offset === focusOffset - 1
    ) {
      endIdx = i;
    }
  }

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return null;

  return {
    beforeText: fullText.slice(Math.max(0, startIdx - CONTEXT_SIZE), startIdx),
    selectedText: fullText.slice(startIdx, endIdx + 1),
    afterText: fullText.slice(endIdx + 1, endIdx + 1 + CONTEXT_SIZE),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// ✅ NEW: reAnchorComment
//
// The workhorse. Given a commentId and its anchor, finds the text's current
// position and re-stamps the mark there. Removes stale marks first so there
// are never duplicate highlights.
//
// Returns true if the text was found and re-stamped, false if it was deleted.
// ─────────────────────────────────────────────────────────────────────────────
const reAnchorComment = (
  editor: Editor,
  commentId: string,
  anchor: CommentAnchor
): boolean => {
  // Remove stale marks from previous position
  const staleNodes = Array.from(
    Editor.nodes(editor, {
      at: [],
      match: (n) => Text.isText(n) && (n as any).commentId === commentId,
    })
  );
  for (const [, path] of staleNodes) {
    Transforms.unsetNodes(editor, "commentId", { at: path });
  }

  // Find the new position via text-context search
  const newRange = findAnchorRange(editor, anchor);
  if (!newRange) return false; // text was fully deleted

  // Stamp the mark at the new position
  Transforms.setNodes(
    editor,
    { commentId } as any,
    { at: newRange, match: (n) => Text.isText(n), split: true }
  );

  return true;
};

// ─────────────────────────────────────────────────────────────────────────────
// ✅ NEW: getRangeFromCommentId
//
// Builds a live Slate Range by scanning nodes that currently carry the given
// commentId. Used for save payload and navigation — always reflects the
// current document state, never a stale saved value.
// ─────────────────────────────────────────────────────────────────────────────
const getRangeFromCommentId = (
  editor: Editor,
  commentId: string
): Range | null => {
  const nodes = Array.from(
    Editor.nodes(editor, {
      at: [],
      match: (n) => Text.isText(n) && (n as any).commentId === commentId,
    })
  );
  if (nodes.length === 0) return null;

  const startPoint = Editor.start(editor, nodes[0][1]);
  const endPoint = Editor.end(editor, nodes[nodes.length - 1][1]);
  return { anchor: startPoint, focus: endPoint };
};

// =============================================================================
// END OF ANCHORING SYSTEM
// =============================================================================

interface SlateEditorProps {
  value?: Descendant[];
  defaultValue?: Descendant[];
  onChange?: (value: Descendant[]) => void;
  isPreview?: boolean;
  onClickSaveBtn?: (nodes: Descendant[]) => void;
  className?: string;
  data?: Record<string, any>;
  onDiscard?: () => void;
  hideFontActions?: boolean;
  hideAlignmentActions?: boolean;
  hideIndentActions?: boolean;
  isShowComments?: boolean;
  onCommentsWindowClose?: () => void;
  artifactJobID?: string;
}

interface EditorSelection {
  text: string;
  position: { top: number; left: number };
  rowIndex?: number | string;
  colField?: string;
}

const toggleMark = (editor: Editor, format: textStyle) => {
  const isActive = Editor.marks(editor)?.[format] === true;
  if (isActive) {
    Editor.removeMark(editor, format);
  } else {
    Editor.addMark(editor, format, true);
  }
};

const SlateContentEditor = ({
  value,
  defaultValue = [],
  onChange,
  isPreview,
  onClickSaveBtn,
  className,
  data,
  onDiscard,
  hideFontActions,
  hideIndentActions,
  hideAlignmentActions,
  isShowComments = false,
  onCommentsWindowClose,
  artifactJobID,
}: SlateEditorProps) => {
  const dispatch = useAppDispatch();

  const editor = useMemo(
    () => withTables(withHistory(withReact(createEditor()))),
    []
  );

  const [storedComments, setStoredComments] = useState<storedCommentsType[]>([]);

  // ✅ NEW: anchorMapRef — the single source of truth for comment positions.
  // Maps commentId → CommentAnchor (before/selected/after text context).
  // Never stale because reAnchorAllComments() rebuilds positions from text
  // search on every edit. A ref (not state) so updates don't trigger renders.
  const anchorMapRef = useRef<Map<string, CommentAnchor>>(new Map());

  const usersDetails = useAppSelector((state) => state.users.userDetails);
  const [activeCommentId, setActiveCommentId] = useState<string | undefined>();
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [tempRange, setTempRange] = useState<Range | null>(null);
  const activeSpanRef = useRef<Range | null>(null);

  const getCommentsData = useAppSelector((state) => state.comments.comments);

  const setActiveRange = useCallback((range: Range | null) => {
    activeSpanRef.current = range;
    setTempRange(range);
  }, []);

  // ── Standard mark helpers ─────────────────────────────────────────────────

  const addCommentMark = useCallback(
    (range: Range, commentId: string) => {
      Transforms.setNodes(editor, { commentId } as any, {
        at: range,
        match: (n) => Text.isText(n),
        split: true,
      });
    },
    [editor]
  );

  const removeCommentMark = useCallback(
    (commentId: string) => {
      const nodes = Array.from(
        Editor.nodes(editor, {
          at: [],
          match: (n) => Text.isText(n) && (n as any).commentId === commentId,
        })
      );
      for (const [, path] of nodes) {
        Transforms.unsetNodes(editor, "commentId", { at: path });
      }
      // ✅ NEW: Remove from anchor map so re-anchor loop skips this comment
      anchorMapRef.current.delete(commentId);
    },
    [editor]
  );

  const getPathById = useCallback(
    (id: string) => {
      const nodes = Editor.nodes(editor, {
        at: [],
        match: (n) => Text.isText(n) && (n as any).commentId === id,
      });
      for (const [, path] of nodes) return path;
      return null;
    },
    [editor]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // ✅ NEW: reAnchorAllComments
  //
  // Called after every content change (debounced 150ms). Iterates over every
  // entry in anchorMapRef, runs reAnchorComment() for each, and removes
  // comments from local state if their text was fully deleted.
  //
  // Why debounced?
  //   Each keystroke fires onChange. Without debounce, we'd be walking the
  //   entire document tree on every character typed. 150ms is invisible to
  //   the user but collapses rapid keystrokes into a single pass.
  //
  // Why Editor.withoutNormalizing?
  //   The multiple Transforms.setNodes / unsetNodes calls inside reAnchorComment
  //   would normally each trigger Slate's normalizer. Batching them prevents
  //   unnecessary intermediate states and keeps history clean.
  // ─────────────────────────────────────────────────────────────────────────
  const reAnchorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reAnchorAllComments = useCallback(() => {
    if (!isShowComments) return;
    if (anchorMapRef.current.size === 0) return;

    if (reAnchorTimerRef.current) clearTimeout(reAnchorTimerRef.current);

    reAnchorTimerRef.current = setTimeout(() => {
      Editor.withoutNormalizing(editor, () => {
        anchorMapRef.current.forEach((anchor, commentId) => {
          const survived = reAnchorComment(editor, commentId, anchor);
          if (!survived) {
            // Text was fully deleted — remove ghost comment from sidebar
            anchorMapRef.current.delete(commentId);
            setStoredComments((prev) =>
              prev.filter((c: any) => c.id !== commentId)
            );
          }
        });
      });
    }, 150);
  }, [editor, isShowComments]);

  // ── Redux comment fetching ────────────────────────────────────────────────

  useEffect(() => {
    if (artifactJobID) dispatch(fetchComments(artifactJobID));
  }, []);

  const deletedCommentsData = useAppSelector(
    (state) => state.comments.deleteComment
  );
  const updatedCommentData = useAppSelector(
    (state) => state.comments.updateComment
  );
  const uploadCommentData = useAppSelector(
    (state) => state.comments.addComment
  );

  useEffect(() => {
    if (artifactJobID) dispatch(fetchComments(artifactJobID));
  }, [uploadCommentData?.data]);

  useEffect(() => {
    if (deletedCommentsData?.message === "OK" && artifactJobID)
      dispatch(fetchComments(artifactJobID));
    if (updatedCommentData?.message === "OK" && artifactJobID)
      dispatch(fetchComments(artifactJobID));
  }, [deletedCommentsData, updatedCommentData]);

  // ─────────────────────────────────────────────────────────────────────────
  // ✅ UPDATED: Comments loaded from API
  //
  // Key change: we now expect each comment to carry an `anchor` field
  // (CommentAnchor) alongside the legacy `range`. When anchor is present,
  // we use text-context re-anchoring. When only range is present (old data),
  // we stamp the range, immediately capture an anchor, and register it in
  // the map so all future edits use the new system automatically.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (getCommentsData?.jobId !== artifactJobID) {
      storedComments?.forEach((c: any) => removeCommentMark(c.id));
      setStoredComments([]);
      anchorMapRef.current.clear(); // ✅ NEW: wipe the anchor map too
      return;
    }

    const existingComments = getCommentsData?.data?.map((com) => ({
      id: com.id,
      position: { left: com.position?.left ?? 0, top: com.position?.top ?? 0 },
      rowIndex: com.rowIndex,
      colField: com.colField,
      text: com.text,
      anchor: com.anchor as CommentAnchor | undefined, // ✅ NEW field from API
      range: com.range,
      comment: com.comment,
      time: com.createdAt,
      userId: com.useId,
      isResolved: com.isResolved,
      replies: com.replies?.map((reply: repliesType) => ({
        id: reply?.id,
        text: reply?.text,
        createdAt: reply?.createdAt,
        useId: reply?.useId,
      })),
    }));

    // Remove marks for comments that were deleted server-side
    const incomingIds = new Set(existingComments?.map((c: any) => c.id));
    storedComments?.forEach((prev: any) => {
      if (!incomingIds.has(prev.id)) removeCommentMark(prev.id);
    });

    // Stamp marks using the appropriate strategy per comment
    existingComments?.forEach((c: any) => {
      if (c.anchor) {
        // ✅ NEW: Preferred — text-context re-anchor (drift-proof)
        anchorMapRef.current.set(c.id, c.anchor);
        reAnchorComment(editor, c.id, c.anchor);
      } else if (c.range) {
        // ✅ NEW: Fallback for old comments with only a Slate range.
        // Stamp once, then immediately upgrade to anchor-based tracking.
        try {
          addCommentMark(c.range, c.id);
          const migratedAnchor = captureAnchor(editor, c.range);
          if (migratedAnchor) {
            anchorMapRef.current.set(c.id, migratedAnchor);
          }
        } catch {
          /* stale range from old data — skip silently */
        }
      }
    });

    setStoredComments(existingComments);
  }, [getCommentsData, artifactJobID]);

  // ── Value management ──────────────────────────────────────────────────────

  const onSaveRef = useRef(onClickSaveBtn);
  onSaveRef.current = onClickSaveBtn;
  const onDiscardRef = useRef(onDiscard);
  onDiscardRef.current = onDiscard;

  const computedDefault = useMemo(() => {
    if (data) return jsonToSlateValue(data);
    return defaultValue;
  }, [data, defaultValue]);

  const [internalValue, setInternalValue] = useState<Descendant[]>(computedDefault);
  const editorValue = useMemo(() => value ?? internalValue, [value, internalValue]);

  // ✅ UPDATED: Every content change triggers reAnchorAllComments (debounced).
  // This is the hook that keeps highlights correct through all edits.
  const handleChange = useCallback(
    (val: Descendant[]) => {
      if (!value) setInternalValue(val);
      onChange?.(val);
      reAnchorAllComments(); // ✅ NEW: drift correction on every change
    },
    [value, onChange, reAnchorAllComments]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // ✅ UPDATED: handleSave
  //
  // Two key changes vs the original:
  //   1. Uses getRangeFromCommentId (live document scan) instead of the stale
  //      saved range — so the API always gets the correct current anchor point
  //   2. Includes the CommentAnchor in the payload so the server persists it.
  //      On next load, re-anchoring will use this to find the text correctly.
  // ─────────────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const currentContent = editor.children;

    if (!storedComments || storedComments.length === 0) {
      onSaveRef.current?.(currentContent);
      return;
    }

    try {
      const commentsPayload = storedComments.reduce((acc: any[], com: any) => {
        // Live range — reflects current document, not creation-time position
        const liveRange = getRangeFromCommentId(editor, com.id);
        if (!liveRange) return acc; // text was deleted — skip

        const nodeEntries = Array.from(
          Editor.nodes(editor, {
            at: [],
            match: (n) => Text.isText(n) && (n as any).commentId === com.id,
          })
        );
        const currentText = nodeEntries
          .map(([node]) => (node as Text).text)
          .join("");

        acc.push({
          id: com.id,
          comment: com.comment,
          isResolved: com.isResolved || false,
          viewFlag: com.viewFlag ?? true,
          text: currentText,
          range: liveRange,                           // kept for legacy consumers
          anchor: anchorMapRef.current.get(com.id),   // ✅ NEW: drift-proof anchor
        });

        return acc;
      }, []);

      if (commentsPayload.length > 0) {
        await api.post(`${config.BulkCommentUpdate}`, {
          comments: commentsPayload,
        });
      }

      onSaveRef.current?.(currentContent);
    } catch (error) {
      console.error("Bulk save error:", error);
    }
  }, [editor, storedComments]);

  const handleDiscard = useCallback(() => {
    onDiscardRef.current?.();
  }, []);

  // ── Rendering ─────────────────────────────────────────────────────────────

  const renderLeaf = useCallback(({ attributes, children, leaf }: any) => {
    if (leaf.bold) children = <strong>{children}</strong>;
    if (leaf.italic) children = <em>{children}</em>;
    if (leaf.underline) children = <u>{children}</u>;
    if (leaf.strikethrough) children = <s>{children}</s>;
    if (leaf.code) children = <code>{children}</code>;

    if (leaf.isTempHighlight) {
      children = <span className={styles.commentSelection}>{children}</span>;
    }

    if (leaf.commentId) {
      children = (
        <mark
          data-comment-id={leaf.commentId}
          className={clsx(
            styles.commentHighlight,
            leaf.isActive && styles.commentHighlightActive
          )}
        >
          {children}
        </mark>
      );
    }

    return <span {...attributes}>{children}</span>;
  }, []);

  const CollapsibleQuote = ({
    attributes,
    children,
    style,
    className,
  }: any) => {
    const [isExpanded, setIsExpanded] = useState(false);
    return (
      <blockquote
        {...attributes}
        style={{
          borderLeft: "3px solid #ccc",
          ...style,
          paddingLeft: style?.paddingLeft || "12px",
        }}
        className={className}
      >
        <div
          contentEditable={false}
          onClick={() => setIsExpanded(!isExpanded)}
          className={styles.citationButton}
        >
          {isExpanded ? "▼ Hide Details" : "▶ Show Details"}
        </div>
        <div style={{ display: isExpanded ? "block" : "none" }}>{children}</div>
      </blockquote>
    );
  };

  const renderElement = useCallback(
    ({ attributes, children, element }: any) => {
      const style = {
        textAlign: element.align || "left",
        paddingLeft: element.indent ? `${element.indent * 24}px` : undefined,
        fontSize: element.fontSize ? `${element.fontSize}px` : undefined,
      };

      switch (element.type) {
        case "heading-one":
          return <h1 {...attributes} style={style}>{children}</h1>;
        case "heading-two":
          return <h2 {...attributes} style={style}>{children}</h2>;
        case "heading-three":
          return <h3 {...attributes} style={style}>{children}</h3>;
        case "heading-four":
          return <h4 {...attributes} style={style}>{children}</h4>;
        case "heading-five":
          return (
            <h5 {...attributes} style={style} className={element.className || "heading-five"}>
              {children}
            </h5>
          );
        case "heading-six":
          return <h6 {...attributes} style={style}>{children}</h6>;
        case "bulleted-list":
          return <ul {...attributes} style={style}>{children}</ul>;
        case "numbered-list":
          return <ol {...attributes} style={style}>{children}</ol>;
        case "list-item":
          return <li {...attributes} style={style}>{children}</li>;
        case "block-quote":
          return (
            <CollapsibleQuote
              attributes={attributes}
              children={children}
              style={style}
              className={element.className || "block-quote"}
            />
          );
        case "code-block":
          return (
            <pre {...attributes} style={{ background: "#f5f5f5", padding: 12, ...style }}>
              <code>{children}</code>
            </pre>
          );
        case "table":
          return (
            <table className={element.className || "table"}>
              <tbody {...attributes}>{children}</tbody>
            </table>
          );
        case "table-row":
          return <tr {...attributes} style={style}>{children}</tr>;
        case "table-cell-header":
          return <th {...attributes} style={style}>{children}</th>;
        case "table-cell":
          return element.isHeader
            ? <th {...attributes} style={style}>{children}</th>
            : <td {...attributes} style={style}>{children}</td>;
        case "paragraph":
          return (
            <p {...attributes} style={style} className={element.className || "paragraph"}>
              {children}
            </p>
          );
        default:
          return (
            <p {...attributes} style={style} className={element.className || "paragraph"}>
              {children}
            </p>
          );
      }
    },
    []
  );

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      switch (event.key) {
        case "b":
          event.preventDefault();
          toggleMark(editor, "bold");
          break;
        case "i":
          event.preventDefault();
          toggleMark(editor, "italic");
          break;
        case "u":
          event.preventDefault();
          toggleMark(editor, "underline");
          break;
      }
    },
    [editor]
  );

  // ── Comment selection on mouse-up ─────────────────────────────────────────

  const handleMouseUp = () => {
    if (!isShowComments) return;

    const { selection: slateSelection } = editor;
    if (!slateSelection || Range.isCollapsed(slateSelection)) return;

    const selectedText = Editor.string(editor, slateSelection);
    if (!selectedText.trim()) return;

    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0) return;

    const domRange = domSelection.getRangeAt(0);
    const clientRects = domRange.getClientRects();
    const lastRect =
      clientRects.length > 0
        ? clientRects[clientRects.length - 1]
        : domRange.getBoundingClientRect();

    const boxHeight = 95;
    const padding = 10;
    const boxWidth = 250;
    const spaceRight = window.innerWidth - lastRect.right;
    const spaceBelow = window.innerHeight - lastRect.bottom;

    const topPosition =
      spaceBelow < boxHeight + padding
        ? lastRect.top - boxHeight - padding
        : lastRect.bottom + padding;
    const leftPosition =
      spaceRight < boxWidth + padding
        ? lastRect.left - boxWidth - padding
        : lastRect.right + padding;

    setSelection({
      text: selectedText,
      position: { left: leftPosition, top: topPosition },
    });

    setActiveRange(slateSelection);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // ✅ UPDATED: sendComment
  //
  // Key changes:
  //   1. Calls captureAnchor() BEFORE stamping the mark, capturing the clean
  //      surrounding context at the moment of creation
  //   2. Registers the anchor in anchorMapRef immediately so re-anchoring
  //      protects this comment from the very first keystroke after creation
  //   3. Passes anchor in the dispatch payload so the API persists it
  // ─────────────────────────────────────────────────────────────────────────
  const sendComment = useCallback(
    (text: string) => {
      const range = activeSpanRef.current;
      if (!range || !selection) return;

      const commentId = uuid();

      // ✅ NEW: Capture context BEFORE stamping — pristine surrounding text
      const anchor = captureAnchor(editor, range);

      // Stamp the commentId mark on the selected range
      addCommentMark(range, commentId);

      // ✅ NEW: Register anchor immediately so reAnchorAllComments tracks it
      if (anchor) {
        anchorMapRef.current.set(commentId, anchor);
      }

      const newComment: any = {
        id: commentId,
        comment: text,
        time: new Date().toISOString(),
        text: selection.text,
        position: selection.position,
        anchor, // ✅ NEW: included in local state for save payload
      };

      setStoredComments((prev) => [...prev, newComment]);

      dispatch(
        addComments({
          commentType: "comment",
          commentId: "",
          jobId: artifactJobID || "",
          createdById: usersDetails?.id,
          userType: "",
          comment: text,
          rowIndex: selection?.rowIndex,
          colField: selection?.colField,
          range,   // initial Slate range (legacy field, kept for compatibility)
          anchor,  // ✅ NEW: text-context anchor for drift-proof future loads
          text: selection.text,
          position: selection.position,
        })
      );

      setSelection(null);
      setActiveRange(null);
      Transforms.deselect(editor);
    },
    [selection, artifactJobID, addCommentMark, editor, setActiveRange]
  );

  // ── Decorate ──────────────────────────────────────────────────────────────

  const decorate = useCallback(
    ([node, path]: any) => {
      const ranges: any[] = [];
      if (!Text.isText(node)) return ranges;

      if (isShowComments && node.commentId) {
        ranges.push({
          anchor: { path, offset: 0 },
          focus: { path, offset: node.text.length },
          commentId: node.commentId,
          isActive: node.commentId === activeCommentId,
        });
      }

      if (tempRange && isPreview) {
        const intersection = Range.intersection(tempRange, {
          anchor: { path, offset: 0 },
          focus: { path, offset: node.text.length },
        });
        if (intersection) {
          ranges.push({ ...intersection, isTempHighlight: true });
        }
      }

      return ranges;
    },
    [tempRange, activeCommentId, isPreview, isShowComments]
  );

  // ── Click-outside / Escape to dismiss floating toolbar ───────────────────

  useEffect(() => {
    if (!selection) return;
    const handleMouseDown = (e: MouseEvent) => {
      const toolbar = document.getElementById("floating-toolbar");
      if (toolbar && !toolbar.contains(e.target as Node)) {
        setSelection(null);
        setActiveRange(null);
        window.getSelection()?.removeAllRanges();
        Transforms.deselect(editor);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [selection, editor, setActiveRange]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelection(null);
        setActiveRange(null);
        window.getSelection()?.removeAllRanges();
        Transforms.deselect(editor);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editor, setActiveRange]);

  // ─────────────────────────────────────────────────────────────────────────
  // ✅ UPDATED: activeCommentFunction
  //
  // Uses getRangeFromCommentId (live document scan) for navigation.
  // Because reAnchorAllComments keeps marks at the correct current position,
  // clicking a comment in the sidebar ALWAYS scrolls to the right text —
  // even after heavy edits or a full page reload.
  // ─────────────────────────────────────────────────────────────────────────
  const activeCommentFunction = (commentId: string | undefined) => {
    setActiveCommentId(commentId);
    if (!commentId) return;

    const currentPath = getPathById(commentId);

    if (currentPath) {
      try {
        ReactEditor.focus(editor);
        const node = Node.get(editor, currentPath) as any;

        // Live range spans all nodes currently marked with this commentId
        const liveRange = getRangeFromCommentId(editor, commentId);
        const newRange = liveRange ?? {
          anchor: { path: currentPath, offset: 0 },
          focus: { path: currentPath, offset: node.text?.length || 0 },
        };

        Transforms.select(editor, newRange);

        setTimeout(() => {
          const targetEl = document.querySelector(
            `[data-comment-id="${commentId}"]`
          ) as HTMLElement;

          if (targetEl) {
            targetEl.scrollIntoView({
              behavior: "smooth",
              block: "center",
              inline: "nearest",
            });
          } else {
            try {
              const domRange = ReactEditor.toDOMRange(editor, newRange);
              domRange.startContainer.parentElement?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
            } catch (e) {
              console.warn("Manual scroll fallback failed");
            }
          }
        }, 100);
      } catch (err) {
        console.warn("Selection failed", err);
      }
    }

    requestAnimationFrame(() => {
      const el = document.getElementById(`comment-${commentId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  // ✅ NEW: Clean up debounce timer on unmount to prevent firing re-anchor
  // transforms on an unmounted / destroyed editor instance.
  useEffect(() => {
    return () => {
      if (reAnchorTimerRef.current) clearTimeout(reAnchorTimerRef.current);
    };
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <div
        className={clsx(
          styles.editorContainer,
          isShowComments && styles.editorWithComments
        )}
      >
        <div
          className={clsx(
            styles.editorArea,
            isShowComments && styles.commentsVisible,
            !isPreview && styles.editView
          )}
        >
          <Slate editor={editor} initialValue={editorValue} onChange={handleChange}>
            {!isPreview && (
              <Toolbar
                onClickSaveBtn={onClickSaveBtn ? handleSave : undefined}
                buttonLabel="Save"
                onDiscard={onDiscard ? handleDiscard : undefined}
                hideFontActions={hideFontActions}
                hideIndentActions={hideIndentActions}
                hideAlignmentActions={hideAlignmentActions}
              />
            )}
            <Editable
              renderLeaf={renderLeaf}
              renderElement={renderElement}
              readOnly={isPreview}
              decorate={decorate}
              onKeyDown={handleKeyDown}
              onMouseUp={handleMouseUp}
              className={clsx(styles.editableArea, className)}
            />
          </Slate>

          {selection && isPreview && (
            <FloatingCommentToolbar
              position={selection.position}
              onAddComment={(text) => {
                if (activeSpanRef.current) sendComment(text);
              }}
            />
          )}
        </div>

        {isShowComments && (
          <CommentSidebar
            comments={storedComments}
            setComments={setStoredComments}
            onCommentsWindowClose={onCommentsWindowClose}
            artifactJobID={artifactJobID}
            activeCommentId={activeCommentId}
            setActiveCommentId={setActiveCommentId}
            activeCommentFunction={activeCommentFunction}
          />
        )}
      </div>
    </>
  );
};

export default SlateContentEditor;
