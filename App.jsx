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
//
// WHY: Reading editor.selection inside React's onChange fires one render
// after decorate() has already run — so the temp highlight lags one
// keystroke. Patching onChange directly means setActiveRange is called
// synchronously inside the same Slate operation, so decorate() always
// sees the up-to-date range on the very next render.
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
  // activeRange must be STATE so decorate() re-runs whenever it changes.
  // activeRangeRef mirrors it for callbacks that close over a stale snapshot.
  const [activeRange, setActiveRange] = useState<Range | null>(null);
  const activeRangeRef = useRef<Range | null>(null);

  // Gate: only run withSelectionSync while the floating toolbar is open.
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

  // activeCommentId — ID of the comment clicked in the sidebar.
  // Changing this state causes decorate() to re-run (it's in its dep array),
  // which flips the isActive flag on the matching range → renderLeaf applies
  // styles.activeHighlight. This is the ONLY mechanism needed; no document
  // mutation is required.
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
  // storedComments is the single source of truth for ALL comment highlights.
  // decorate() reads it directly — no document marks are written. This means:
  //   • Adding a comment    → push to storedComments → decorate re-runs → highlight appears.
  //   • Deleting a comment  → remove from storedComments → decorate re-runs → highlight gone.
  //   • Activating a comment → setActiveCommentId → decorate re-runs → active colour applied.
  // No addCommentMark / removeCommentMark document mutations needed at all.
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
  // THREE highlight states, all driven purely by decorate() flags on the leaf:
  //
  //   leaf.isTempHighlight  → styles.commentSelection   (blue, while toolbar open)
  //   leaf.commentId        → styles.commentHighlight   (yellow, persisted comment)
  //   leaf.isActive = true  → styles.activeHighlight    (orange/bold, sidebar click)
  //
  // Because ALL three come from decorate(), changing activeCommentId state
  // (in activeCommentFunction) is enough to flip the active colour — no
  // document write, no ref gymnastics.
  //
  // data-comment-id on <span> enables the DOM-fallback scroll in
  // activeCommentFunction when the stored Slate range is stale.
  const renderLeaf = useCallback(
    ({ attributes, children, leaf }: any) => {
      if (leaf.bold)          children = <strong>{children}</strong>;
      if (leaf.italic)        children = <em>{children}</em>;
      if (leaf.underline)     children = <u>{children}</u>;
      if (leaf.strikethrough) children = <s>{children}</s>;
      if (leaf.code)          children = <code>{children}</code>;

      // Temporary selection highlight (floating toolbar is open)
      if (leaf.isTempHighlight) {
        children = (
          <span className={styles.commentSelection}>
            {children}
          </span>
        );
      }

      // Persisted comment highlight.
      // <span> is used intentionally instead of <mark> — the HTML <mark> element
      // carries a browser-default yellow background that cannot be fully overridden
      // by just adding a className. Using <span> means our CSS classes are the
      // sole source of colour for both commentHighlight and activeHighlight.
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
    // Re-memoize when activeCommentId changes so renderLeaf picks up the new
    // isActive value from the leaf (which decorate already stamped correctly).
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
        case "heading-one":   return <h1 {...attributes} style={style}>{children}</h1>;
        case "heading-two":   return <h2 {...attributes} style={style}>{children}</h2>;
        case "heading-three": return <h3 {...attributes} style={style}>{children}</h3>;
        case "heading-four":  return <h4 {...attributes} style={style}>{children}</h4>;
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
        case "table-row":        return <tr {...attributes} style={style}>{children}</tr>;
        case "table-cell-header": return <th {...attributes} style={style}>{children}</th>;
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
  // The single source of truth for ALL visual highlights in the editor.
  //
  // It produces three kinds of decorated ranges on Text leaves:
  //
  //   isTempHighlight          → blue preview while floating toolbar is open
  //   commentId                → yellow highlight for every persisted comment
  //   commentId + isActive:true → active (orange) highlight when sidebar clicked
  //
  // KEY INSIGHT: because isActive is computed here as (comment.id === activeCommentId),
  // simply calling setActiveCommentId(id) is enough to switch the active highlight.
  // Slate re-runs decorate() because activeCommentId is in its dependency array,
  // and renderLeaf applies styles.activeHighlight when leaf.isActive is true.
  // Zero document mutations required for the active highlight.
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
          if (intersection) {
            ranges.push({ ...intersection, isTempHighlight: true });
          }
        } catch {
          // activeRange can be stale after undo — skip silently
        }
      }

      // 2. Persisted comment highlights + active state
      if (isShowComments) {
        for (const comment of storedComments) {
          if (!comment.range) continue;
          try {
            const intersection = Range.intersection(comment.range, nodeRange);
            if (intersection) {
              ranges.push({
                ...intersection,
                commentId: comment.id,
                // This flag is what drives the active colour in renderLeaf.
                // It updates automatically when activeCommentId state changes
                // because activeCommentId is in this useCallback's dep array.
                isActive: comment.id === activeCommentId,
              });
            }
          } catch {
            // Stale stored range — skip silently
          }
        }
      }

      return ranges;
    },
    [storedComments, activeCommentId, activeRange, isShowComments],
  );

  // ── clearCommentingState ───────────────────────────────────────────────────
  const clearCommentingState = useCallback(() => {
    setSelection(null);
    isCommentingActiveRef.current = false;
    activeRangeRef.current = null;
    setActiveRange(null);
    window.getSelection()?.removeAllRanges();
    Transforms.deselect(editor);
  }, [editor]);

  // ── handleMouseUp — open the floating toolbar ──────────────────────────────
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

      // Activate withSelectionSync so typing/deleting extends the temp highlight
      isCommentingActiveRef.current = true;
      activeRangeRef.current = slateSelection;
      setActiveRange(slateSelection);
    },
    [editor, isShowComments],
  );

  // ── sendComment ────────────────────────────────────────────────────────────
  // Saves the range into storedComments — that's all that's needed for the
  // highlight to appear. decorate() reads storedComments directly.
  const sendComment = useCallback(
    (text: string) => {
      const range = activeRangeRef.current;
      if (!range || !selection) return;

      const commentId = uuid();

      const newComment: any = {
        id: commentId,
        comment: text,
        time: new Date().toISOString(),
        range,
        selectedText: selection.text,
      };

      // Push into storedComments → decorate() re-runs → highlight appears
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

      clearCommentingState();
    },
    [selection, artifactJobID, editor, clearCommentingState],
  );

  // ── Close toolbar when clicking outside ────────────────────────────────────
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

  // ── Close toolbar on Escape ────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearCommentingState();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [clearCommentingState]);

  // ── findRangeByText — live range rehydration ──────────────────────────────
  // When text is added or removed after a comment was created, the stored
  // range's path/offset values become stale and Transforms.select throws (or
  // selects the wrong span). This helper searches every Text leaf in the live
  // document for one that contains the comment's original selectedText and
  // returns a fresh, valid Range pointing to it.
  //
  // It uses a simple substring search — good enough for comment highlighting.
  // If the text was edited so heavily that the original string no longer exists,
  // it returns null and we fall back to the querySelector scroll.
  const findRangeByText = useCallback(
    (searchText: string): Range | null => {
      if (!searchText.trim()) return null;
      for (const [node, path] of Editor.nodes(editor, {
        at: [],
        match: (n) => Text.isText(n),
      })) {
        const textNode = node as Text;
        const idx = textNode.text.indexOf(searchText);
        if (idx !== -1) {
          return {
            anchor: { path, offset: idx },
            focus:  { path, offset: idx + searchText.length },
          };
        }
      }
      return null;
    },
    [editor],
  );

  // ── activeCommentFunction — sidebar comment click ──────────────────────────
  // 1. setActiveCommentId(id) → decorate() re-runs with isActive:true on the
  //    matching range → renderLeaf applies styles.activeHighlight.
  //
  // 2. Scrolls the editor to the highlighted text. Two-phase range resolution:
  //    a. Try the stored range directly (works when text hasn't been edited).
  //    b. If the stored range is stale, call findRangeByText() to locate the
  //       original selectedText in the live document, then update storedComments
  //       with the fresh range so future clicks work without rehydration.
  //    c. If the text itself was deleted, fall back to data-comment-id querySelector.
  //
  // 3. Scrolls the sidebar card into view.
  const activeCommentFunction = useCallback(
    (commentId: string | undefined) => {
      // Step 1: flip active colour via state → decorate → renderLeaf
      setActiveCommentId(commentId);
      if (!commentId) return;

      const target = storedComments.find((c: any) => c.id === commentId);
      if (!target) return;

      // Step 2: scroll editor to the text
      const scrollToRange = (range: Range) => {
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
        }
      };

      if (target.range) {
        // Phase a: try the stored range as-is
        let rangeValid = false;
        try {
          // Editor.range throws if path is out of bounds — use it as a validity check
          Editor.range(editor, target.range);
          rangeValid = true;
        } catch {
          rangeValid = false;
        }

        if (rangeValid) {
          scrollToRange(target.range);
        } else {
          // Phase b: stored range is stale — rehydrate from live document text
          const freshRange = target.text
            ? findRangeByText(target.text)        // text = the original selectedText
            : null;

          if (freshRange) {
            // Persist the fresh range back so the next click is instant
            setStoredComments((prev) =>
              prev.map((c) => (c.id === commentId ? { ...c, range: freshRange } : c)),
            );
            scrollToRange(freshRange);
          } else {
            // Phase c: text no longer exists — scroll via DOM attribute
            document
              .querySelector(`[data-comment-id="${commentId}"]`)
              ?.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }
      }

      // Step 3: scroll the sidebar card
      requestAnimationFrame(() => {
        document
          .getElementById(`comment-${commentId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [editor, storedComments, findRangeByText],
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
