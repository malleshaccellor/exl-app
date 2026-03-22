import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createEditor,
  type Descendant,
  Editor,
  Range,
  Transforms,
  Text,
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
import { fetchComments } from "../../store/reducer/comments/action";
import FloatingCommentToolbar from "../FloatingCommentToolbar";
import { v4 as uuid } from "uuid";

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface StoredComment {
  id: string;
  comment: string;
  time: string;
  range: Range;
  selectedText: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LS_KEY = "editor-comments";

function loadComments(): StoredComment[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveToLS(comments: StoredComment[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(comments));
}

const toggleMark = (editor: Editor, format: textStyle) => {
  const isActive = Editor.marks(editor)?.[format] === true;
  if (isActive) Editor.removeMark(editor, format);
  else Editor.addMark(editor, format, true);
};

// ─── Component ────────────────────────────────────────────────────────────────

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

  const editor = useMemo(
    () => withTables(withHistory(withReact(createEditor()))),
    [],
  );

  // ── Comment state ──────────────────────────────────────────────────────────

  const [storedComments, setStoredComments] = useState<StoredComment[]>(loadComments);

  // Reload from localStorage whenever the sidebar is toggled open
  useEffect(() => {
    if (isShowComments) setStoredComments(loadComments());
  }, [isShowComments]);

  const [activeCommentId, setActiveCommentId] = useState<string | undefined>();

  // Drives the floating toolbar visibility. When null = toolbar is hidden.
  const [selectionInfo, setSelectionInfo] = useState<{
    text: string;
    position: { top: number; left: number };
  } | null>(null);

  // The pending Slate range is stored in a ref so decorate can read it
  // synchronously without stale-closure issues.
  // It is always cleared at the same time as selectionInfo.
  const pendingRangeRef = useRef<Range | null>(null);

  // Bumping this forces decorate to re-run even when only the ref changed
  const [decorateVersion, setDecorateVersion] = useState(0);
  const bumpDecorate = useCallback(() => setDecorateVersion((v) => v + 1), []);

  // ── Redux ──────────────────────────────────────────────────────────────────

  const deletedCommentsData = useAppSelector(
    (state) => state.comments.deleteComment,
  );
  const updatedCommentData = useAppSelector(
    (state) => state.comments.updateComment,
  );
  const uploadCommentData = useAppSelector(
    (state) => state.comments.addComment,
  );

  // Single mount fetch — removed duplicate
  useEffect(() => {
    if (artifactJobID) dispatch(fetchComments(artifactJobID));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (artifactJobID) dispatch(fetchComments(artifactJobID));
  }, [uploadCommentData?.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!artifactJobID) return;
    if (
      deletedCommentsData?.message === "OK" ||
      updatedCommentData?.message === "OK"
    ) {
      dispatch(fetchComments(artifactJobID));
    }
  }, [deletedCommentsData, updatedCommentData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Editor value ──────────────────────────────────────────────────────────

  const computedDefault = useMemo(() => {
    if (data) return jsonToSlateValue(data);
    return defaultValue;
  }, [data, defaultValue]);

  const [internalValue, setInternalValue] =
    useState<Descendant[]>(computedDefault);

  const editorValue = useMemo(
    () => value ?? internalValue,
    [value, internalValue],
  );

  const handleChange = useCallback(
    (val: Descendant[]) => {
      if (!value) setInternalValue(val);
      onChange?.(val);
    },
    [value, onChange],
  );

  // ── Save / Discard callbacks ───────────────────────────────────────────────

  const onSaveRef = useRef(onClickSaveBtn);
  onSaveRef.current = onClickSaveBtn;
  const onDiscardRef = useRef(onDiscard);
  onDiscardRef.current = onDiscard;

  const handleSave = useCallback(() => {
    onSaveRef.current?.(editor.children);
  }, [editor]);

  const handleDiscard = useCallback(() => {
    onDiscardRef.current?.();
  }, []);

  // ── Cancel pending selection ───────────────────────────────────────────────
  // Called on: Escape key, outside click, Cancel button in toolbar
  const cancelPendingSelection = useCallback(() => {
    pendingRangeRef.current = null;
    setSelectionInfo(null);
    Transforms.deselect(editor);
    bumpDecorate(); // clears isTempHighlight immediately
  }, [editor, bumpDecorate]);

  // Escape key listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelPendingSelection();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [cancelPendingSelection]);

  // Outside-click listener (active only while toolbar is visible)
  useEffect(() => {
    if (!selectionInfo) return;
    const handler = (e: MouseEvent) => {
      const toolbar = document.getElementById("floating-toolbar");
      if (toolbar?.contains(e.target as Node)) return;
      cancelPendingSelection();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [selectionInfo, cancelPendingSelection]);

  // ── decorate ──────────────────────────────────────────────────────────────

  const decorate = useCallback(
    ([node, path]: any) => {
      const ranges: any[] = [];
      if (!Text.isText(node)) return ranges;

      const nodeRange: Range = {
        anchor: { path, offset: 0 },
        focus: { path, offset: node.text.length },
      };

      // 1. Temp highlight — shown while the user has a pending selection
      if (pendingRangeRef.current) {
        const intersection = Range.intersection(
          pendingRangeRef.current,
          nodeRange,
        );
        if (intersection) {
          ranges.push({ ...intersection, isTempHighlight: true });
        }
      }

      // 2. Saved comment highlights (only when sidebar is open)
      if (isShowComments) {
        for (const comment of storedComments) {
          if (!comment.range) continue;
          const intersection = Range.intersection(comment.range, nodeRange);
          if (intersection) {
            ranges.push({
              ...intersection,
              commentId: comment.id,
              isActive: comment.id === activeCommentId,
            });
          }
        }
      }

      return ranges;
    },
    // decorateVersion intentionally included to force re-runs after cancel/submit
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storedComments, activeCommentId, isShowComments, decorateVersion],
  );

  // ── renderLeaf ────────────────────────────────────────────────────────────

  const renderLeaf = useCallback(
    ({ attributes, children, leaf }: any) => {
      let el = children;

      // Apply standard inline marks first (they wrap the innermost text node)
      if (leaf.bold) el = <strong>{el}</strong>;
      if (leaf.italic) el = <em>{el}</em>;
      if (leaf.underline) el = <u>{el}</u>;
      if (leaf.strikethrough) el = <s>{el}</s>;
      if (leaf.code) el = <code>{el}</code>;

      // Temp highlight — blue while selecting before submitting
      if (leaf.isTempHighlight) {
        el = (
          <span style={{ backgroundColor: "#e0f2fe" }}>
            {el}
          </span>
        );
      }

      // Saved comment highlight — grey normally, blue when active
      if (leaf.commentId) {
        el = (
          <mark
            className={clsx(
              styles.commentHighlight,
              leaf.isActive && styles.activeHighlight,
            )}
            style={{
              backgroundColor: leaf.isActive ? "#e0f2fe" : "#eeeeee",
              textDecoration: "none",
              cursor: "pointer",
              color: "inherit",
            }}
            onClick={() => activeCommentFunction(leaf.commentId)}
          >
            {el}
          </mark>
        );
      }

      // IMPORTANT: {...attributes} is only ever spread once, on the outer <span>
      return <span {...attributes}>{el}</span>;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeCommentId],
  );

  // ── renderElement ─────────────────────────────────────────────────────────

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
            <blockquote
              {...attributes}
              style={{
                borderLeft: "3px solid #ccc",
                color: "#666",
                ...style,
                paddingLeft: style.paddingLeft || "12px",
              }}
            >
              {children}
            </blockquote>
          );
        case "code-block":
          return (
            <pre
              {...attributes}
              style={{ background: "#f5f5f5", padding: 12, ...style }}
            >
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
    [],
  );

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      switch (event.key) {
        case "b": event.preventDefault(); toggleMark(editor, "bold"); break;
        case "i": event.preventDefault(); toggleMark(editor, "italic"); break;
        case "u": event.preventDefault(); toggleMark(editor, "underline"); break;
      }
    },
    [editor],
  );

  // ── Mouse-up: capture selection, show floating toolbar ────────────────────

  const handleMouseUp = useCallback(
    (_e: React.MouseEvent) => {
      if (!isShowComments) return;

      const { selection: slateSelection } = editor;

      if (!slateSelection || Range.isCollapsed(slateSelection)) {
        // Clicked without selecting — cancel any pending state
        cancelPendingSelection();
        return;
      }

      const selectedText = Editor.string(editor, slateSelection);
      if (!selectedText.trim()) {
        cancelPendingSelection();
        return;
      }

      const domSelection = window.getSelection();
      const rect = domSelection?.getRangeAt(0)?.getBoundingClientRect();

      // Store the Slate range in the ref so decorate picks it up
      pendingRangeRef.current = slateSelection;
      bumpDecorate(); // force immediate temp highlight

      setSelectionInfo({
        text: selectedText,
        position: {
          left: (rect?.right ?? 0) + window.scrollX + 8,
          top: (rect?.top ?? 0) + window.scrollY,
        },
      });
    },
    [editor, isShowComments, cancelPendingSelection, bumpDecorate],
  );

  // ── Submit comment ────────────────────────────────────────────────────────

  const sendComment = useCallback(
    (text: string) => {
      const range = pendingRangeRef.current;
      if (!range || !selectionInfo) return;

      const commentId = uuid();

      const newComment: StoredComment = {
        id: commentId,
        comment: text,
        time: new Date().toISOString(),
        range,
        selectedText: selectionInfo.text,
      };

      setStoredComments((prev) => {
        const updated = [...prev, newComment];
        saveToLS(updated);
        return updated;
      });

      // Clear pending state — highlight transitions from temp (blue) to saved (grey)
      pendingRangeRef.current = null;
      setSelectionInfo(null);
      Transforms.deselect(editor);
      bumpDecorate();
    },
    [selectionInfo, editor, bumpDecorate],
  );

  // ── Activate comment (click in sidebar or on highlight) ───────────────────

  const activeCommentFunction = useCallback(
    (commentId: string | undefined) => {
      setActiveCommentId(commentId);
      if (!commentId) return;

      const target = storedComments.find((c) => c.id === commentId);
      if (target?.range) {
        try {
          ReactEditor.focus(editor);
          Transforms.select(editor, target.range);
          const domRange = ReactEditor.toDOMRange(editor, target.range);
          domRange.startContainer.parentElement?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        } catch (e) {
          console.warn("Could not scroll to comment range", e);
        }
      }

      requestAnimationFrame(() => {
        document
          .getElementById(`comment-${commentId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [editor, storedComments],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className={clsx(
        styles.editorContainer,
        isShowComments && styles.editorWithComments,
      )}
    >
      <div className={styles.editorArea}>
        <Slate
          editor={editor}
          initialValue={editorValue}
          onChange={handleChange}
        >
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

      {selectionInfo && (
        <FloatingCommentToolbar
          position={selectionInfo.position}
          onAddComment={(text) => sendComment(text)}
          onCancel={cancelPendingSelection}
        />
      )}
    </div>
  );
};

export default SlateContentEditor;
