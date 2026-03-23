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
  position: {
    top: number;
    left: number;
  };
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
    [],
  );

  const [storedComments, setStoredComments] = useState<storedCommentsType[]>([]);
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

  // ─── FIX 1: Validate path existence before applying mark ─────────────────────
  const isRangeValid = useCallback(
    (range: Range): boolean => {
      try {
        const [anchorNode] = Editor.node(editor, range.anchor.path);
        const [focusNode] = Editor.node(editor, range.focus.path);
        if (!anchorNode || !focusNode) return false;

        // Check offsets are within text bounds
        if (Text.isText(anchorNode) && range.anchor.offset > anchorNode.text.length)
          return false;
        if (Text.isText(focusNode) && range.focus.offset > focusNode.text.length)
          return false;

        return true;
      } catch {
        return false;
      }
    },
    [editor],
  );

  // ─── FIX 2: Wrap addCommentMark with path validity check ────────────────────
  const addCommentMark = useCallback(
    (range: Range, commentId: string) => {
      try {
        if (!isRangeValid(range)) {
          console.warn("Skipping invalid range for comment:", commentId);
          return;
        }
        const previousSelection = editor.selection;
        Transforms.select(editor, range);
        Transforms.setNodes(editor, { commentId } as Partial<Text>, {
          at: range,
          match: (n) => Text.isText(n),
          split: true,
        });
        if (previousSelection && isRangeValid(previousSelection)) {
          Transforms.select(editor, previousSelection);
        } else {
          Transforms.deselect(editor);
        }
      } catch (e) {
        console.warn("addCommentMark failed for:", commentId, e);
      }
    },
    [editor, isRangeValid],
  );

  const removeCommentMark = useCallback(
    (commentId: string) => {
      try {
        const nodes = Array.from(
          Editor.nodes(editor, {
            at: [],
            match: (n) => Text.isText(n) && (n as any).commentId === commentId,
          }),
        );
        for (const [, path] of nodes) {
          Transforms.unsetNodes(editor, "commentId", { at: path });
        }
      } catch (e) {
        console.warn("removeCommentMark failed for:", commentId, e);
      }
    },
    [editor],
  );

  useEffect(() => {
    if (artifactJobID) dispatch(fetchComments(artifactJobID));
  }, []);

  const deletedCommentsData = useAppSelector(
    (state) => state.comments.deleteComment,
  );
  const updatedCommentData = useAppSelector(
    (state) => state.comments.updateComment,
  );
  const uploadCommentData = useAppSelector(
    (state) => state.comments.addComment,
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

  useEffect(() => {
    if (getCommentsData?.jobId !== artifactJobID) {
      storedComments.forEach((c: any) => removeCommentMark(c.id));
      setStoredComments([]);
      return;
    }

    const existingComments = getCommentsData?.data.map((com) => ({
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

    const incomingIds = new Set(existingComments.map((c: any) => c.id));
    storedComments.forEach((prev: any) => {
      if (!incomingIds.has(prev.id)) removeCommentMark(prev.id);
    });

    // FIX 3: Only apply marks for ranges that are still valid
    existingComments.forEach((c: any) => {
      if (c.range && isRangeValid(c.range)) {
        addCommentMark(c.range, c.id);
      }
    });

    setStoredComments(existingComments);
  }, [getCommentsData, artifactJobID]);

  const onSaveRef = useRef(onClickSaveBtn);
  onSaveRef.current = onClickSaveBtn;
  const onDiscardRef = useRef(onDiscard);
  onDiscardRef.current = onDiscard;

  const computedDefault = useMemo(() => {
    if (data) return jsonToSlateValue(data);
    return defaultValue;
  }, [data, defaultValue]);

  // ─── FIX 4: Stabilize initialValue with a ref — never changes after mount ────
  const initialValueRef = useRef<Descendant[]>(
    value ?? (data ? jsonToSlateValue(data) : defaultValue),
  );

  const [internalValue, setInternalValue] =
    useState<Descendant[]>(computedDefault);

  // ─── FIX 5: Sync controlled `value` prop imperatively, not via initialValue ──
  const prevValueRef = useRef<Descendant[] | undefined>(value);
  useEffect(() => {
    if (!value) return;
    if (value === prevValueRef.current) return;
    prevValueRef.current = value;

    // Replace document content without re-mounting the editor
    try {
      editor.children = value;
      editor.onChange();
    } catch (e) {
      console.warn("Failed to sync controlled value:", e);
    }
  }, [value, editor]);

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

  const handleSave = useCallback(() => {
    onSaveRef.current?.(editor.children);
  }, [editor]);

  const handleDiscard = useCallback(() => {
    onDiscardRef.current?.();
  }, []);

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
            leaf.isActive && styles.commentHighlightActive,
          )}
        >
          {children}
        </mark>
      );
    }

    return <span {...attributes}>{children}</span>;
  }, []);

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
          return element.isHeader ? (
            <th {...attributes} style={style}>{children}</th>
          ) : (
            <td {...attributes} style={style}>{children}</td>
          );
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
    [editor],
  );

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

    setSelection({
      text: selectedText,
      position: { left: lastRect.right, top: lastRect.bottom },
    });

    setActiveRange(slateSelection);
  };

  const sendComment = useCallback(
    (text: string) => {
      const range = activeSpanRef.current;
      if (!range || !selection) return;

      const commentId = uuid();
      addCommentMark(range, commentId);

      const newComment: any = {
        id: commentId,
        comment: text,
        time: new Date().toISOString(),
        range,
        text: selection.text,
        position: selection.position,
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
          range,
          text: selection.text,
          position: selection.position,
        }),
      );

      setSelection(null);
      setActiveRange(null);
      Transforms.deselect(editor);
    },
    [selection, artifactJobID, addCommentMark, editor, setActiveRange],
  );

  // ─── FIX 6: Guard decorate against out-of-bounds / stale ranges ─────────────
  const decorate = useCallback(
    ([node, path]: any) => {
      const ranges: any[] = [];
      if (!Text.isText(node)) return ranges;

      const nodeRange: Range = {
        anchor: { path, offset: 0 },
        focus: { path, offset: node.text.length },
      };

      if (tempRange && isPreview) {
        try {
          if (isRangeValid(tempRange)) {
            const intersection = Range.intersection(tempRange, nodeRange);
            if (intersection) {
              ranges.push({ ...intersection, isTempHighlight: true });
            }
          }
        } catch {
          /* stale range */
        }
      }

      if (isShowComments) {
        storedComments.forEach((comment: any) => {
          if (!comment.range) return;
          try {
            if (!isRangeValid(comment.range)) return;
            const intersection = Range.intersection(comment.range, nodeRange);
            if (intersection) {
              ranges.push({
                ...intersection,
                commentId: comment.id,
                isActive: comment.id === activeCommentId,
              });
            }
          } catch {
            /* stale range, skip */
          }
        });
      }

      return ranges;
    },
    [tempRange, activeCommentId, isShowComments, storedComments, isRangeValid, isPreview],
  );

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

  const activeCommentFunction = (commentId: string | undefined) => {
    setActiveCommentId(commentId);
    if (!commentId) return;

    const target = storedComments.find((c: any) => c.id === commentId);
    if (target?.range) {
      try {
        if (!isRangeValid(target.range)) return;
        ReactEditor.focus(editor);
        Transforms.select(editor, target.range);
        const domRange = ReactEditor.toDOMRange(editor, target.range);
        domRange.startContainer.parentElement?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        Transforms.deselect(editor);
        window.getSelection()?.removeAllRanges();
      } catch (e) {
        console.warn("Could not scroll to comment range", e);
      }
    }

    requestAnimationFrame(() => {
      const el = document.getElementById(`comment-${commentId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  return (
    <>
      <div
        className={clsx(
          styles.editorContainer,
          isShowComments && styles.editorWithComments,
        )}
      >
        <div className={clsx(styles.editorArea, isShowComments && styles.commentsVisible)}>
          {/* FIX 7: Use initialValueRef.current so Slate never re-mounts on value change */}
          <Slate
            editor={editor}
            initialValue={initialValueRef.current}
            onChange={handleChange}
          >
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
