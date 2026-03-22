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
// pastes) calls onSelectionChange with the current live selection.
//
// WHY: Reading editor.selection inside React's onChange fires one render
// after decorate() has already run — so the temp highlight always lags
// one keystroke behind. Patching onChange directly means setActiveRange
// is called synchronously inside the same Slate operation batch, so
// decorate() always sees the up-to-date range on the next render.
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
// addCommentMark
// ---------------------------------------------------------------------------
// WHY Transforms.setNodes and NOT Editor.addMark:
//
//   Editor.addMark is designed for inline character styles (bold, italic…).
//   It applies the mark to the *current selection* and does NOT split text
//   nodes at the range boundaries — so a comment mark bleeds into adjacent
//   characters that were not selected.
//
//   Transforms.setNodes with { split: true } forces Slate to create a new,
//   isolated leaf node exactly at the given range boundaries. This ensures:
//     • The highlight covers only the selected text.
//     • removeCommentMark can target exactly those nodes later.
//     • Slate merges them back cleanly once the mark is removed.
// ---------------------------------------------------------------------------
const addCommentMark = (
  editor: Editor,
  range: Range,
  commentId: string,
): void => {
  Transforms.setNodes(
    editor,
    { commentId } as Partial<Text>,
    {
      at: range,
      match: (n) => Text.isText(n),
      split: true, // isolates the highlighted leaf at exact range boundaries
    },
  );
  // Deselect so the browser doesn't show a native blue selection on top of
  // the comment highlight.
  Transforms.deselect(editor);
};

// ---------------------------------------------------------------------------
// removeCommentMark
// ---------------------------------------------------------------------------
// Finds every Text leaf carrying the given commentId and unsets the property.
// Slate automatically merges adjacent identical leaves after unset, cleaning
// up the extra nodes that split:true created.
//
// Paths are collected first, then unset — mutating while iterating causes
// path-shift errors.
// ---------------------------------------------------------------------------
const removeCommentMark = (editor: Editor, commentId: string): void => {
  const paths = Array.from(
    Editor.nodes(editor, {
      at: [],
      match: (n) => Text.isText(n) && (n as any).commentId === commentId,
    }),
  ).map(([, path]) => path);

  for (const path of paths) {
    Transforms.unsetNodes(editor, "commentId", { at: path });
  }
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
  position: {
    top: number;
    left: number;
  };
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
  // activeRange must be STATE so decorate() re-runs whenever it changes.
  // activeRangeRef mirrors it for use inside callbacks that close over a
  // stale snapshot (sendComment, onAddComment handler).
  const [activeRange, setActiveRange] = useState<Range | null>(null);
  const activeRangeRef = useRef<Range | null>(null);

  // Gate: only track via withSelectionSync while the floating toolbar is open.
  const isCommentingActiveRef = useRef(false);

  const editor = useMemo(() => {
    const base = withTables(withHistory(withReact(createEditor())));
    return withSelectionSync(base, (sel) => {
      if (!isCommentingActiveRef.current) return;
      // Update both state and ref on every Slate operation so decorate()
      // always has the current range, including after typing/deleting.
      activeRangeRef.current = sel;
      setActiveRange(sel);
    });
  }, []);

  // ── App state ─────────────────────────────────────────────────────────────
  const [storedComments, setStoredComments] = useState<storedCommentsType[]>([]);
  const usersDetails = useAppSelector((state) => state.users.userDetails);
  const [activeCommentId, setActiveCommentId] = useState<string | undefined>();
  // EditorSelection holds the toolbar position + selected text metadata.
  const [selection, setSelection] = useState<EditorSelection | null>(null);

  const getCommentsData = useAppSelector((state) => state.comments.comments);
  const deletedCommentsData = useAppSelector((state) => state.comments.deleteComment);
  const updatedCommentData = useAppSelector((state) => state.comments.updateComment);
  const uploadCommentData = useAppSelector((state) => state.comments.addComment);

  // ── Data fetching ─────────────────────────────────────────────────────────
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

  // ── Sync API → storedComments + editor marks ──────────────────────────────
  // When comments are fetched from the API:
  //   • New comments  → addCommentMark applied to the document.
  //   • Deleted/resolved comments → removeCommentMark cleans the document.
  // This keeps the visual marks in the editor perfectly in sync with the
  // server state without any extra manual wiring.
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

    setStoredComments((prev) => {
      const incomingIds = new Set(incoming.map((c) => c.id));
      const prevIds = new Set(prev.map((c) => c.id));

      // Remove marks for comments deleted on the server
      for (const old of prev) {
        if (!incomingIds.has(old.id)) {
          try {
            removeCommentMark(editor, old.id);
          } catch (e) {
            console.warn("removeCommentMark failed for", old.id, e);
          }
        }
      }

      // Apply marks for brand-new comments arriving from the server
      for (const com of incoming) {
        if (!prevIds.has(com.id) && com.range) {
          try {
            addCommentMark(editor, com.range, com.id);
          } catch (e) {
            console.warn("addCommentMark failed for", com.id, e);
          }
        }
      }

      return incoming;
    });
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

  // ── renderLeaf ────────────────────────────────────────────────────────────
  const renderLeaf = useCallback(
    ({ attributes, children, leaf }: any) => {
      // Standard inline marks
      if (leaf.bold)          children = <strong>{children}</strong>;
      if (leaf.italic)        children = <em>{children}</em>;
      if (leaf.underline)     children = <u>{children}</u>;
      if (leaf.strikethrough) children = <s>{children}</s>;
      if (leaf.code)          children = <code>{children}</code>;

      // Temporary highlight while the floating toolbar is open.
      // Set by decorate() via the isTempHighlight flag — purely presentational,
      // never written to the document.
      if (leaf.isTempHighlight) {
        children = (
          <span className={styles.commentSelection}>
            {children}
          </span>
        );
      }

      // Persisted comment highlight applied via addCommentMark.
      // data-comment-id enables the DOM-fallback scroll in activeCommentFunction.
      if (leaf.commentId) {
        children = (
          <mark
            data-comment-id={leaf.commentId}
            className={clsx(
              styles.commentHighlight,
              leaf.isActive && styles.activeHighlight,
            )}
          >
            {children}
          </mark>
        );
      }

      return <span {...attributes}>{children}</span>;
    },
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
    [],
  );

  // ── handleKeyDown ─────────────────────────────────────────────────────────
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

  // ── decorate ──────────────────────────────────────────────────────────────
  // Produces two kinds of decorated ranges on Text leaves:
  //
  // 1. isTempHighlight — light-blue preview while the floating toolbar is open.
  //    Driven by `activeRange` state (kept live by withSelectionSync), so the
  //    highlight tracks edits in real time without touching the document.
  //
  // 2. commentId / isActive — overlay highlight for persisted comments, driven
  //    by storedComments. These complement the marks already in the document
  //    so the activeHighlight CSS class can be toggled without a document write.
  //
  // Both try/catch their Range.intersection calls because stored ranges can
  // become stale after undo/redo — safe to skip silently.
  const decorate = useCallback(
    ([node, path]: NodeEntry) => {
      const ranges: any[] = [];
      if (!Text.isText(node)) return ranges;

      const nodeRange: Range = {
        anchor: { path, offset: 0 },
        focus: { path, offset: node.text.length },
      };

      // 1. Temporary highlight
      if (activeRange) {
        try {
          const intersection = Range.intersection(activeRange, nodeRange);
          if (intersection) {
            ranges.push({ ...intersection, isTempHighlight: true });
          }
        } catch {
          // Stale activeRange after undo — ignore
        }
      }

      // 2. Persisted comment highlights
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
          } catch {
            // Stale stored range — ignore
          }
        }
      }

      return ranges;
    },
    [storedComments, activeCommentId, activeRange, isShowComments],
  );

  // ── clearCommentingState ──────────────────────────────────────────────────
  // Single place to tear down all commenting UI state so there is no risk
  // of partial cleanup leaving a phantom highlight or stale ref.
  const clearCommentingState = useCallback(() => {
    setSelection(null);
    isCommentingActiveRef.current = false;
    activeRangeRef.current = null;
    setActiveRange(null);
    window.getSelection()?.removeAllRanges();
    Transforms.deselect(editor);
  }, [editor]);

  // ── handleMouseUp — open the floating toolbar ─────────────────────────────
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
      const lastRect =
        clientRects.length > 0
          ? clientRects[clientRects.length - 1]
          : domRange.getBoundingClientRect();

      setSelection({
        text: selectedText,
        position: { left: lastRect.right, top: lastRect.bottom },
      });

      // Activate withSelectionSync live tracking
      isCommentingActiveRef.current = true;
      activeRangeRef.current = slateSelection;
      setActiveRange(slateSelection);
    },
    [editor, isShowComments],
  );

  // ── sendComment — persist the comment and stamp the document mark ─────────
  const sendComment = useCallback(
    (text: string) => {
      // Read from ref so we always get the latest range, even if the React
      // state snapshot captured by this closure is one render stale.
      const range = activeRangeRef.current;
      if (!range || !selection) return;

      const commentId = uuid();

      // Stamp the persistent comment mark onto the document.
      // Uses addCommentMark (Transforms.setNodes + split:true) — not
      // Editor.addMark — so only the exact selected characters are highlighted.
      try {
        addCommentMark(editor, range, commentId);
      } catch (e) {
        console.warn("addCommentMark failed:", e);
      }

      const newComment: any = {
        id: commentId,
        comment: text,
        time: new Date().toISOString(),
        range,
        selectedText: selection.text,
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

      // Close toolbar, stop tracking, remove temp highlight
      clearCommentingState();
    },
    [selection, artifactJobID, editor, clearCommentingState],
  );

  // ── Close toolbar when clicking outside ───────────────────────────────────
  useEffect(() => {
    if (!selection) return;
    const handleMouseDown = (e: MouseEvent) => {
      const toolbar = document.getElementById("floating-toolbar");
      if (toolbar && !toolbar.contains(e.target as Node)) {
        clearCommentingState();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [selection, clearCommentingState]);

  // ── Close toolbar on Escape ───────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearCommentingState();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [clearCommentingState]);

  // ── activeCommentFunction — sidebar comment click ─────────────────────────
  // Scrolls the editor to the highlighted text and the sidebar to the card.
  // Primary path: ReactEditor.toDOMRange (may throw if range is stale).
  // Fallback: querySelector on data-comment-id stamped in renderLeaf.
  const activeCommentFunction = useCallback(
    (commentId: string | undefined) => {
      setActiveCommentId(commentId);
      if (!commentId) return;

      const target = storedComments.find((c: any) => c.id === commentId);

      if (target?.range) {
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
            // toDOMRange threw (stale range) — fall back to the stamped mark
            document
              .querySelector(`mark[data-comment-id="${commentId}"]`)
              ?.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        } catch (e) {
          console.warn("Could not scroll to comment range", e);
        }
      }

      // Scroll the sidebar card
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
              if (activeRangeRef.current) {
                sendComment(text);
              }
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
