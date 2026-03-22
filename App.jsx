import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createEditor,
  type Descendant,
  Editor,
  Range,
  Transforms,
  Text,
  Path,
  type BaseOperation,
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
// transformPoint / transformRange
// ---------------------------------------------------------------------------
// Mirrors what Slate does internally to keep editor.selection in sync with
// every document operation. We use the same logic to keep stored comment
// ranges accurate after edits.
//
// WHY this is necessary:
//   A comment range is a snapshot: { anchor: {path, offset}, focus: {path, offset} }
//   taken at the moment the comment was created. Once the user edits the
//   document — inserting text before the comment, pressing Enter inside it,
//   deleting around it — the stored offsets/paths become stale.
//
//   Editor.range(editor, range) only validates that the PATH exists, not that
//   the OFFSETS are still correct. So isRangeValid returns true even when the
//   range silently points to the wrong characters. Range.intersection then
//   returns null or the wrong span, and the highlight disappears or shifts.
//
//   The correct fix is to intercept every Slate operation via editor.apply
//   and update stored ranges in lockstep — exactly as Slate transforms
//   editor.selection. That way the ranges are always accurate, decorate()
//   always intersects correctly, and the highlight always stays on the right text.
// ---------------------------------------------------------------------------
function transformPoint(
  point: { path: number[]; offset: number },
  op: BaseOperation,
): { path: number[]; offset: number } {
  switch (op.type) {
    case "insert_text":
      if (Path.equals(point.path, op.path) && point.offset >= op.offset) {
        return { ...point, offset: point.offset + op.text.length };
      }
      break;

    case "remove_text":
      if (Path.equals(point.path, op.path) && point.offset > op.offset) {
        return {
          ...point,
          offset: Math.max(op.offset, point.offset - op.text.length),
        };
      }
      break;

    case "split_node":
      // A split at position P on path [x] creates [x+1].
      // Points on [x] at or after P move to the new node.
      if (Path.equals(point.path, op.path) && point.offset >= op.position) {
        return {
          path: Path.next(op.path),
          offset: point.offset - op.position,
        };
      }
      // Points on paths after the split path shift right.
      if (Path.isAfter(point.path, op.path)) {
        return { ...point, path: Path.next(point.path) };
      }
      break;

    case "merge_node":
      // Merging path [x] into [x-1]. Points on [x] shift by the previous
      // node's text length (carried in op.properties.text for text nodes).
      if (Path.equals(point.path, op.path)) {
        const prevLen: number =
          typeof (op.properties as any)?.text === "string"
            ? (op.properties as any).text.length
            : 0;
        return {
          path: Path.previous(op.path),
          offset: prevLen + point.offset,
        };
      }
      // Points on paths after the merged node shift left.
      if (Path.isAfter(point.path, op.path)) {
        return { ...point, path: Path.previous(point.path) };
      }
      break;

    case "remove_node":
      if (Path.isAncestor(op.path, point.path) || Path.equals(op.path, point.path)) {
        // The node containing this point was removed — range is now invalid.
        return point; // caller must handle null range
      }
      if (Path.isAfter(point.path, op.path)) {
        return { ...point, path: Path.previous(point.path) };
      }
      break;

    case "insert_node":
      if (Path.isAfter(point.path, op.path) || Path.equals(point.path, op.path)) {
        return { ...point, path: Path.next(point.path) };
      }
      break;
  }
  return point;
}

function transformRange(range: Range, op: BaseOperation): Range {
  return {
    anchor: transformPoint(range.anchor, op),
    focus: transformPoint(range.focus, op),
  };
}

// ---------------------------------------------------------------------------
// withRangeTracking plugin
// ---------------------------------------------------------------------------
// Wraps editor.apply to intercept every operation and update all tracked
// ranges in lockstep with the document. Pass a ref that holds the array of
// ranges to keep in sync; the plugin mutates that array in-place so React
// state is not involved in the hot path.
// ---------------------------------------------------------------------------
function withRangeTracking(
  editor: Editor,
  getRanges: () => Range[],
  setRanges: (updated: Range[]) => void,
): Editor {
  const { apply } = editor;
  editor.apply = (op: BaseOperation) => {
    apply(op);
    // Transform every stored comment range through the just-applied operation
    const current = getRanges();
    if (current.length === 0) return;
    const updated = current.map((r) => (r ? transformRange(r, op) : r));
    setRanges(updated);
  };
  return editor;
}

// ---------------------------------------------------------------------------
// withSelectionSync plugin
// ---------------------------------------------------------------------------
// Patches editor.onChange to fire a callback with the live selection after
// every operation. Used to keep activeRange (temp highlight) current.
// ---------------------------------------------------------------------------
function withSelectionSync(
  editor: Editor,
  onSelectionChange: (sel: Range | null) => void,
): Editor {
  const { onChange } = editor;
  editor.onChange = (options) => {
    onChange(options);
    onSelectionChange(editor.selection);
  };
  return editor;
}

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

const toggleMark = (editor: Editor, format: textStyle) => {
  const isActive = Editor.marks(editor)?.[format] === true;
  if (isActive) Editor.removeMark(editor, format);
  else Editor.addMark(editor, format, true);
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

  // ── Stored comments ────────────────────────────────────────────────────────
  // The ranges inside storedComments are kept accurate by withRangeTracking.
  // Every Slate operation transforms them in lockstep so decorate() always
  // intersects correctly — no rehydration, no stale offsets.
  const [storedComments, setStoredComments] = useState<storedCommentsType[]>([]);
  // Ref so withRangeTracking can read/write without closing over stale state
  const storedCommentsRef = useRef<storedCommentsType[]>([]);
  storedCommentsRef.current = storedComments;

  // ── Temp highlight (floating toolbar open) ─────────────────────────────────
  // activeRange is kept as a ref only — we do NOT need it in React state
  // because decorate() reads editor.selection directly (synchronous, always
  // current). The ref is used by sendComment to capture the final range.
  const activeRangeRef = useRef<Range | null>(null);
  const isCommentingActiveRef = useRef(false);
  // Bump counter forces decorate() re-run without putting the range in state
  const [decorateTick, setDecorateTick] = useState(0);
  const bumpDecorate = useCallback(() => setDecorateTick((n) => n + 1), []);

  // ── Editor ─────────────────────────────────────────────────────────────────
  const editor = useMemo(() => {
    const base = withTables(withHistory(withReact(createEditor())));

    // 1. Track comment ranges through every document operation
    const tracked = withRangeTracking(
      base,
      () => storedCommentsRef.current.map((c) => c.range),
      (updatedRanges) => {
        setStoredComments((prev) =>
          prev.map((c, i) => ({ ...c, range: updatedRanges[i] })),
        );
      },
    );

    // 2. Sync selection changes so we can re-run decorate for temp highlight
    return withSelectionSync(tracked, (sel) => {
      if (!isCommentingActiveRef.current) return;
      activeRangeRef.current = sel;
      // Trigger decorate re-run on every selection change while toolbar is open
      setDecorateTick((n) => n + 1);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── App state ──────────────────────────────────────────────────────────────
  const usersDetails = useAppSelector((state) => state.users.userDetails);
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

  // ── renderLeaf ─────────────────────────────────────────────────────────────
  // All highlight states come from decorate() flags on the leaf:
  //   leaf.isTempHighlight          → commentSelection  (blue, toolbar open)
  //   leaf.commentId                → commentHighlight  (base colour)
  //   leaf.commentId + leaf.isActive → activeHighlight  (sidebar click colour)
  //
  // <span> not <mark> — <mark> has a browser UA yellow background that
  // overrides className-based colours.
  const renderLeaf = useCallback(
    ({ attributes, children, leaf }: any) => {
      if (leaf.bold)          children = <strong>{children}</strong>;
      if (leaf.italic)        children = <em>{children}</em>;
      if (leaf.underline)     children = <u>{children}</u>;
      if (leaf.strikethrough) children = <s>{children}</s>;
      if (leaf.code)          children = <code>{children}</code>;

      if (leaf.isTempHighlight) {
        children = (
          <span className={styles.commentSelection}>{children}</span>
        );
      }

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
          return <h5 {...attributes} style={style} className={element.className || "heading-five"}>{children}</h5>;
        case "heading-six":    return <h6 {...attributes} style={style}>{children}</h6>;
        case "bulleted-list":  return <ul {...attributes} style={style}>{children}</ul>;
        case "numbered-list":  return <ol {...attributes} style={style}>{children}</ol>;
        case "list-item":      return <li {...attributes} style={style}>{children}</li>;
        case "block-quote":
          return (
            <blockquote {...attributes} style={{ borderLeft: "3px solid #ccc", color: "#666", ...style, paddingLeft: style.paddingLeft || "12px" }}>
              {children}
            </blockquote>
          );
        case "code-block":
          return <pre {...attributes} style={{ background: "#f5f5f5", padding: 12, ...style }}><code>{children}</code></pre>;
        case "table":
          return <table className={element.className || "table"}><tbody {...attributes}>{children}</tbody></table>;
        case "table-row":         return <tr {...attributes} style={style}>{children}</tr>;
        case "table-cell-header": return <th {...attributes} style={style}>{children}</th>;
        case "table-cell":
          return element.isHeader
            ? <th {...attributes} style={style}>{children}</th>
            : <td {...attributes} style={style}>{children}</td>;
        case "paragraph":
        default:
          return <p {...attributes} style={style} className={element.className || "paragraph"}>{children}</p>;
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
  // Reads editor.selection directly for the temp highlight — synchronous
  // ground truth, always current, never stale.
  //
  // Reads storedComments for persisted highlights — ranges are always accurate
  // because withRangeTracking transforms them on every operation.
  const decorate = useCallback(
    ([node, path]: NodeEntry) => {
      const ranges: any[] = [];
      if (!Text.isText(node)) return ranges;

      const nodeRange: Range = {
        anchor: { path, offset: 0 },
        focus:  { path, offset: node.text.length },
      };

      // 1. Temp highlight — read editor.selection directly (always current)
      if (isCommentingActiveRef.current) {
        const live = editor.selection;
        if (live && !Range.isCollapsed(live)) {
          try {
            const intersection = Range.intersection(live, nodeRange);
            if (intersection) ranges.push({ ...intersection, isTempHighlight: true });
          } catch { /* skip */ }
        }
      }

      // 2. Persisted comment highlights
      // Ranges are kept accurate by withRangeTracking — just intersect directly.
      if (isShowComments) {
        for (const comment of storedComments) {
          if (!comment.range) continue;
          try {
            const intersection = Range.intersection(comment.range, nodeRange);
            if (intersection) {
              ranges.push({
                ...intersection,
                commentId: comment.id,
                isActive: comment.id === activeCommentId,
              });
            }
          } catch { /* skip stale range */ }
        }
      }

      return ranges;
    },
    // decorateTick forces re-run when withSelectionSync fires during selection
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storedComments, activeCommentId, isShowComments, decorateTick],
  );

  // ── clearCommentingState ───────────────────────────────────────────────────
  const clearCommentingState = useCallback(() => {
    setSelection(null);
    isCommentingActiveRef.current = false;
    activeRangeRef.current = null;
    window.getSelection()?.removeAllRanges();
    Transforms.deselect(editor);
    bumpDecorate();
  }, [editor, bumpDecorate]);

  // ── handleMouseUp ──────────────────────────────────────────────────────────
  const handleMouseUp = useCallback(
    (_e: React.MouseEvent) => {
      if (!isShowComments) return;
      const { selection: slateSelection } = editor;
      if (!slateSelection || Range.isCollapsed(slateSelection)) return;
      const selectedText = Editor.string(editor, slateSelection);
      if (!selectedText.trim()) return;

      const domSel = window.getSelection();
      if (!domSel || domSel.rangeCount === 0) return;
      const domRange = domSel.getRangeAt(0);
      const rects = domRange.getClientRects();
      const last = rects.length > 0 ? rects[rects.length - 1] : domRange.getBoundingClientRect();

      setSelection({
        text: selectedText,
        position: { left: last.right, top: last.bottom },
      });

      isCommentingActiveRef.current = true;
      activeRangeRef.current = slateSelection;
      bumpDecorate();
    },
    [editor, isShowComments, bumpDecorate],
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
    [selection, artifactJobID, clearCommentingState],
  );

  // ── Close toolbar on outside click / Escape ────────────────────────────────
  useEffect(() => {
    if (!selection) return;
    const onMouseDown = (e: MouseEvent) => {
      const toolbar = document.getElementById("floating-toolbar");
      if (toolbar && !toolbar.contains(e.target as Node)) clearCommentingState();
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [selection, clearCommentingState]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") clearCommentingState(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [clearCommentingState]);

  // ── activeCommentFunction ──────────────────────────────────────────────────
  // 1. setActiveCommentId → decorate re-runs → isActive:true → activeHighlight
  // 2. Scroll editor to the comment (range is always current via withRangeTracking)
  // 3. Deselect to remove native blue selection
  // 4. Scroll sidebar card
  const activeCommentFunction = useCallback(
    (commentId: string | undefined) => {
      setActiveCommentId(commentId);
      if (!commentId) return;

      const target = storedComments.find((c: any) => c.id === commentId);
      if (!target?.range) return;

      try {
        ReactEditor.focus(editor);
        Transforms.select(editor, target.range);
        try {
          const domRange = ReactEditor.toDOMRange(editor, target.range);
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
        // Remove native blue selection Transforms.select created
        requestAnimationFrame(() => {
          Transforms.deselect(editor);
          window.getSelection()?.removeAllRanges();
        });
      }

      requestAnimationFrame(() => {
        document
          .getElementById(`comment-${commentId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [editor, storedComments],
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={clsx(styles.editorContainer, isShowComments && styles.editorWithComments)}>
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
