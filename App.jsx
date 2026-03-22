import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createEditor,
  type Descendant,
  Editor,
  Range,
  Transforms,
  Text,
  type NodeEntry,
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

// ---------------------------------------------------------------------------
// withSelectionSync plugin
// ---------------------------------------------------------------------------
// Patches editor.onChange so every Slate operation (keystrokes, deletes,
// pastes) immediately calls onSelectionChange with the live selection.
// This is the only way to keep activeRange in sync during edits — reading
// editor.selection in React's onChange fires one render too late for decorate().
// ---------------------------------------------------------------------------
const withSelectionSync = (
  editor: Editor,
  onSelectionChange: (sel: Range | null) => void,
) => {
  const { onChange } = editor;
  editor.onChange = (options) => {
    onChange(options);
    onSelectionChange(editor.selection);
  };
  return editor;
};

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------
interface SlateEditorProps {
  value?: Descendant[];
  defaultValue?: Descendant[];
  onChange?: (value: Descendant[]) => void;
  readOnly?: boolean;
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
  mode?: boolean;
}

interface EditorSelection {
  text: string;
  position: { top: number; left: number };
  rowIndex?: number | string;
  colField?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const toggleMark = (editor: Editor, format: textStyle) => {
  const isActive = Editor.marks(editor)?.[format] === true;
  if (isActive) {
    Editor.removeMark(editor, format);
  } else {
    Editor.addMark(editor, format, true);
  }
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const SlateContentEditor = ({
  value,
  defaultValue = [],
  onChange,
  readOnly,
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
  mode = false,
}: SlateEditorProps) => {
  const dispatch = useAppDispatch();

  // ── Live selection tracking ──────────────────────────────────────────────
  const [activeRange, setActiveRange] = useState<Range | null>(null);
  const activeRangeRef = useRef<Range | null>(null);
  const isCommentingActiveRef = useRef(false);

  const editor = useMemo(() => {
    const base = withTables(withHistory(withReact(createEditor())));
    return withSelectionSync(base, (sel) => {
      if (!isCommentingActiveRef.current) return;
      activeRangeRef.current = sel;
      setActiveRange(sel);
    });
  }, []);

  // ── App state ──────────────────────────────────────────────────────────────
  const [storedComments, setStoredComments] = useState<storedCommentsType[]>([]);
  const usersDetails = useAppSelector((state) => state.users.userDetails);

  // activeCommentId drives the active highlight colour via decorate().
  // When this changes, decorate() re-runs (it's in its dep array), which
  // sets isActive:true on the matching leaf → renderLeaf applies activeHighlight.
  const [activeCommentId, setActiveCommentId] = useState<string | undefined>();

  const [selection, setSelection] = useState<EditorSelection | null>(null);

  const getCommentsData = useAppSelector((state) => state.comments.comments);
  const deletedCommentsData = useAppSelector((state) => state.comments.deleteComment);
  const updatedCommentData = useAppSelector((state) => state.comments.updateComment);
  const uploadCommentData = useAppSelector((state) => state.comments.addComment);

  // ── Data fetching ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (artifactJobID) dispatch(fetchComments(artifactJobID));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (artifactJobID) dispatch(fetchComments(artifactJobID));
  }, [uploadCommentData?.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!artifactJobID) return;
    if (deletedCommentsData?.message === "OK") dispatch(fetchComments(artifactJobID));
    if (updatedCommentData?.message === "OK") dispatch(fetchComments(artifactJobID));
  }, [deletedCommentsData, updatedCommentData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync API data → storedComments ────────────────────────────────────────
  useEffect(() => {
    if (getCommentsData?.jobId !== artifactJobID) {
      setStoredComments([]);
      return;
    }
    const incoming: storedCommentsType[] = getCommentsData.data.map((com) => ({
      id: com.id,
      position: { left: com.position.left, top: com.position.top },
      rowIndex: com.rowIndex,
      colField: com.colField,
      text: com.text,
      // selectedText is stored separately so range rehydration can find the
      // original commented text even after edits shift the path/offset.
      selectedText: com.text,
      range: com.range,
      comment: com.comment,
      time: com.createdAt,
      userId: com.useId,
      isResolved: com.isResolved,
      replies: com.replies.map((reply: repliesType) => ({
        id: reply?.id,
        text: reply?.text,
        createdAt: reply?.createdAt,
        useId: reply?.useId,
      })),
    }));
    setStoredComments(incoming);
  }, [getCommentsData, artifactJobID]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Editor value ──────────────────────────────────────────────────────────
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

  const handleChange = useCallback(
    (val: Descendant[]) => {
      if (!value) setInternalValue(val);
      onChange?.(val);
    },
    [value, onChange],
  );

  const handleSave = useCallback(() => {
    onSaveRef.current?.(editor.children);
  }, [editor]);

  const handleDiscard = useCallback(() => {
    onDiscardRef.current?.();
  }, []);

  // ── findRangeByText ────────────────────────────────────────────────────────
  // Walks every live Text leaf to find the first occurrence of searchText.
  // Used to rehydrate a stale range after the document has been edited.
  // Returns null if the text no longer exists in the document.
  const findRangeByText = useCallback(
    (searchText: string): Range | null => {
      if (!searchText?.trim()) return null;
      for (const [node, path] of Editor.nodes(editor, {
        at: [],
        match: (n) => Text.isText(n),
      })) {
        const idx = (node as Text).text.indexOf(searchText);
        if (idx !== -1) {
          return {
            anchor: { path, offset: idx },
            focus: { path, offset: idx + searchText.length },
          };
        }
      }
      return null;
    },
    [editor],
  );

  // ── isRangeValid ───────────────────────────────────────────────────────────
  // Returns true only if both anchor and focus paths still exist in the live
  // document. Editor.range throws when a path is out of bounds.
  const isRangeValid = useCallback(
    (range: Range): boolean => {
      try {
        Editor.range(editor, range);
        return true;
      } catch {
        return false;
      }
    },
    [editor],
  );

  // ── renderLeaf ─────────────────────────────────────────────────────────────
  // All three highlight states come purely from decorate() flags on the leaf:
  //
  //   leaf.isTempHighlight          → styles.commentSelection  (temp, toolbar open)
  //   leaf.commentId                → styles.commentHighlight  (persisted comment)
  //   leaf.commentId + leaf.isActive → styles.activeHighlight  (sidebar click)
  //
  // <span> is used (not <mark>) to prevent the browser's built-in UA stylesheet
  // yellow background on <mark> from interfering with our CSS classes.
  //
  // FIX — default blue selection removed:
  // activeCommentFunction calls Transforms.deselect() after scrolling so
  // editor.selection is cleared and Slate never renders its native blue
  // selection caret on the commented text.
  const renderLeaf = useCallback(
    ({ attributes, children, leaf }: any) => {
      if (leaf.bold)          children = <strong>{children}</strong>;
      if (leaf.italic)        children = <em>{children}</em>;
      if (leaf.underline)     children = <u>{children}</u>;
      if (leaf.strikethrough) children = <s>{children}</s>;
      if (leaf.code)          children = <code>{children}</code>;

      // Temporary selection highlight (shown while the floating toolbar is open)
      if (leaf.isTempHighlight) {
        children = (
          <span className={styles.commentSelection}>
            {children}
          </span>
        );
      }

      // Persisted comment highlight + active state.
      // leaf.isActive is stamped by decorate() when leaf.commentId === activeCommentId.
      // Changing activeCommentId state triggers decorate() re-run → leaf.isActive
      // flips → renderLeaf re-renders with the correct highlight class.
      if (leaf.commentId) {
        children = (
          <span
            data-comment-id={leaf.commentId}
            className={clsx(
              styles.commentHighlight,
              leaf.isActive && styles.activeHighlight,
            )}
          >
            {children}
          </span>
        );
      }

      return <span {...attributes}>{children}</span>;
    },
    [activeCommentId],
  );

  // ── renderElement ──────────────────────────────────────────────────────────
  const renderElement = useCallback(
    ({ attributes, children, element }: any) => {
      const style = {
        textAlign: element.align || "left",
        paddingLeft: element.indent ? `${element.indent * 24}px` : undefined,
        fontSize: element.fontSize ? `${element.fontSize}px` : undefined,
      };
      switch (element.type) {
        case "heading-one":    return <h1 {...attributes} style={style}>{children}</h1>;
        case "heading-two":    return <h2 {...attributes} style={style}>{children}</h2>;
        case "heading-three":  return <h3 {...attributes} style={style}>{children}</h3>;
        case "heading-four":   return <h4 {...attributes} style={style}>{children}</h4>;
        case "heading-five":
          return (
            <h5 {...attributes} style={style} className={element.className || "heading-five"}>
              {children}
            </h5>
          );
        case "heading-six":    return <h6 {...attributes} style={style}>{children}</h6>;
        case "bulleted-list":  return <ul {...attributes} style={style}>{children}</ul>;
        case "numbered-list":  return <ol {...attributes} style={style}>{children}</ol>;
        case "list-item":      return <li {...attributes} style={style}>{children}</li>;
        case "block-quote":
          return (
            <blockquote
              {...attributes}
              style={{ borderLeft: "3px solid #ccc", color: "#666", ...style, paddingLeft: style.paddingLeft || "12px" }}
            >
              {children}
            </blockquote>
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
        case "table-row":         return <tr {...attributes} style={style}>{children}</tr>;
        case "table-cell-header": return <th {...attributes} style={style}>{children}</th>;
        case "table-cell":
          return element.isHeader
            ? <th {...attributes} style={style}>{children}</th>
            : <td {...attributes} style={style}>{children}</td>;
        case "paragraph":
        default:
          return (
            <p {...attributes} style={style} className={element.className || "paragraph"}>
              {children}
            </p>
          );
      }
    },
    [],
  );

  // ── handleKeyDown ──────────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      switch (event.key) {
        case "b": event.preventDefault(); toggleMark(editor, "bold");      break;
        case "i": event.preventDefault(); toggleMark(editor, "italic");    break;
        case "u": event.preventDefault(); toggleMark(editor, "underline"); break;
      }
    },
    [editor],
  );

  // ── decorate ───────────────────────────────────────────────────────────────
  // Single source of truth for ALL visual highlights.
  //
  // Produces three kinds of decorated ranges on Text leaves:
  //   isTempHighlight          — blue preview while floating toolbar is open
  //   commentId                — base comment highlight colour
  //   commentId + isActive:true — active colour when sidebar comment is clicked
  //
  // FIX — highlight after edit:
  // For each comment, we first check if its stored range is still valid.
  // If it is stale (path out of bounds after edits), we call findRangeByText
  // to locate the original selectedText in the live document and update
  // storedComments with the fresh range. This means decorate itself drives
  // range rehydration on every render — the highlight is always up to date.
  const decorateRef = useRef<(entry: NodeEntry) => any[]>(() => []);

  const decorate = useCallback(
    ([node, path]: NodeEntry) => {
      const ranges: any[] = [];
      if (!Text.isText(node)) return ranges;

      const nodeRange: Range = {
        anchor: { path, offset: 0 },
        focus:  { path, offset: node.text.length },
      };

      // 1. Temporary highlight (floating toolbar open)
      if (activeRange) {
        try {
          const intersection = Range.intersection(activeRange, nodeRange);
          if (intersection) ranges.push({ ...intersection, isTempHighlight: true });
        } catch {
          // Stale activeRange after undo — skip
        }
      }

      // 2. Persisted comment highlights with stale-range rehydration
      if (isShowComments) {
        for (const comment of storedComments) {
          // Determine the effective range — use stored range if valid,
          // otherwise fall back to searching the live document by selectedText.
          let effectiveRange: Range | null = null;

          if (comment.range && isRangeValid(comment.range)) {
            effectiveRange = comment.range;
          } else {
            // Stored range is stale (text was added/removed around it).
            // Search the live document for the original selected text.
            const freshRange = findRangeByText(comment.selectedText || comment.text);
            if (freshRange) {
              effectiveRange = freshRange;
              // Persist the fresh range back into storedComments so:
              //  a) Future decorate() calls skip rehydration (fast path)
              //  b) activeCommentFunction uses the correct range for scrolling
              // Use setTimeout to avoid calling setState during render.
              setTimeout(() => {
                setStoredComments((prev) =>
                  prev.map((c) =>
                    c.id === comment.id ? { ...c, range: freshRange } : c,
                  ),
                );
              }, 0);
            }
          }

          if (!effectiveRange) continue;

          try {
            const intersection = Range.intersection(effectiveRange, nodeRange);
            if (intersection) {
              ranges.push({
                ...intersection,
                commentId: comment.id,
                isActive: comment.id === activeCommentId,
              });
            }
          } catch {
            // Skip silently
          }
        }
      }

      return ranges;
    },
    [storedComments, activeCommentId, activeRange, isShowComments, isRangeValid, findRangeByText],
  );

  decorateRef.current = decorate;

  // ── clearCommentingState ───────────────────────────────────────────────────
  const clearCommentingState = useCallback(() => {
    setSelection(null);
    isCommentingActiveRef.current = false;
    activeRangeRef.current = null;
    setActiveRange(null);
    window.getSelection()?.removeAllRanges();
    Transforms.deselect(editor);
  }, [editor]);

  // ── handleMouseUp — open floating toolbar ─────────────────────────────────
  const handleMouseUp = useCallback(
    (_e: React.MouseEvent) => {
      if (!isShowComments) return;
      const { selection: slateSelection } = editor;
      if (!slateSelection || Range.isCollapsed(slateSelection)) return;
      const selectedText = Editor.string(editor, slateSelection);
      if (!selectedText.trim()) return;

      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0) return;
      const domRange = domSelection.getRangeAt(0);
      const clientRects = domRange.getClientRects();
      const lastRect = clientRects.length > 0
        ? clientRects[clientRects.length - 1]
        : domRange.getBoundingClientRect();

      setSelection({
        text: selectedText,
        position: { left: lastRect.right, top: lastRect.bottom },
      });

      isCommentingActiveRef.current = true;
      activeRangeRef.current = slateSelection;
      setActiveRange(slateSelection);
    },
    [editor, isShowComments],
  );

  // ── sendComment ────────────────────────────────────────────────────────────
  const sendComment = useCallback(
    (text: string) => {
      const range = activeRangeRef.current;
      if (!range || !selection) return;

      const commentId = uuid();

      setStoredComments((prev) => [
        ...prev,
        {
          id: commentId,
          comment: text,
          time: new Date().toISOString(),
          range,
          // Store the selected text so decorate() can rehydrate the range
          // after edits shift the original path/offset values.
          selectedText: selection.text,
          text: selection.text,
        } as any,
      ]);

      dispatch(
        addComments({
          commentType: "comment",
          commentId: "",
          jobId: artifactJobID || "",
          createdById: usersDetails?.id,
          userType: "",
          comment: text,
          rowIndex: selection.rowIndex,
          colField: selection.colField,
          range,
          text: selection.text,
          position: {
            left: selection.position.left,
            top: selection.position.top,
          },
        } as any),
      );

      clearCommentingState();
    },
    [selection, artifactJobID, editor, clearCommentingState],
  );

  // ── Close toolbar on outside click ────────────────────────────────────────
  useEffect(() => {
    if (!selection) return;
    const handleMouseDown = (e: MouseEvent) => {
      const toolbar = document.getElementById("floating-toolbar");
      if (toolbar && !toolbar.contains(e.target as Node)) clearCommentingState();
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [selection, clearCommentingState]);

  // ── Close toolbar on Escape ────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearCommentingState();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [clearCommentingState]);

  // ── activeCommentFunction — sidebar comment click ──────────────────────────
  //
  // Three things happen in order:
  //
  // 1. setActiveCommentId(commentId)
  //    → decorate() re-runs with isActive:true for matching leaves
  //    → renderLeaf applies styles.activeHighlight
  //    This is the entire active-colour mechanism — no document write needed.
  //
  // 2. Scroll the editor to the highlighted text.
  //    Uses the comment's current range from storedComments (which decorate()
  //    may have already rehydrated if the text was edited).
  //    Falls back to querySelector('[data-comment-id]') if the range is unusable.
  //
  // 3. FIX — default blue selection removed:
  //    After scrolling, Transforms.deselect() clears editor.selection so Slate
  //    does not render its native blue selection caret over the comment text.
  //
  // 4. Scroll the sidebar card into view.
  const activeCommentFunction = useCallback(
    (commentId: string | undefined) => {
      // Step 1: flip active colour
      setActiveCommentId(commentId);
      if (!commentId) return;

      const target = storedComments.find((c: any) => c.id === commentId);
      if (!target) return;

      // Resolve the best available range (storedComments may already have a
      // fresh range if decorate() rehydrated it; otherwise try here too).
      const resolveRange = (): Range | null => {
        if (target.range && isRangeValid(target.range)) return target.range;
        return findRangeByText(target.selectedText || target.text);
      };

      const range = resolveRange();

      // Step 2 + 3: scroll then deselect
      if (range) {
        try {
          ReactEditor.focus(editor);
          Transforms.select(editor, range);

          try {
            const domRange = ReactEditor.toDOMRange(editor, range);
            domRange.startContainer.parentElement?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          } catch {
            document
              .querySelector(`[data-comment-id="${commentId}"]`)
              ?.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        } catch {
          document
            .querySelector(`[data-comment-id="${commentId}"]`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        } finally {
          // FIX: remove the native blue selection that Transforms.select creates.
          // Deselecting after the scroll ensures the browser has already
          // processed the scroll position before we clear the selection.
          requestAnimationFrame(() => {
            Transforms.deselect(editor);
            window.getSelection()?.removeAllRanges();
          });
        }
      } else {
        // Text no longer in document — scroll via DOM attribute only
        document
          .querySelector(`[data-comment-id="${commentId}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }

      // Step 4: scroll the sidebar card
      requestAnimationFrame(() => {
        document
          .getElementById(`comment-${commentId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [editor, storedComments, isRangeValid, findRangeByText],
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className={clsx(
        styles.editorContainer,
        isShowComments && styles.editorWithComments,
      )}
    >
      <div className={styles.editorArea}>
        <Slate editor={editor} initialValue={editorValue} onChange={handleChange}>
          {!mode && (
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
            readOnly={readOnly}
            decorate={decorate}
            onKeyDown={handleKeyDown}
            onMouseUp={handleMouseUp}
            className={clsx(styles.editableArea, className)}
          />
        </Slate>

        {selection && (
          <FloatingCommentToolbar
            position={selection.position}
            onAddComment={(text) => {
              if (activeRangeRef.current) sendComment(text);
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
  );
};

export default SlateContentEditor;
