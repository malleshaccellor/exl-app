import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createEditor, Editor, type Descendant, Range } from "slate";
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
import { fetchComments } from "../../store/reducer/comments/action";
import FloatingCommentToolbar from "../FloatingCommentToolbar";

export type selectionType = {
  position: {
    left: number | string;
    top: number | string;
  };
  text: string;
  slateRange: Range;
};

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

const toggleMark = (editor: Editor, format: textStyle) => {
  const isActive = Editor.marks(editor)?.[format] === true;
  if (isActive) {
    Editor.removeMark(editor, format);
  } else {
    Editor.addMark(editor, format, true);
  }
};

export const SlateContentEditor = ({
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
  const pageRef = useRef<HTMLDivElement>(null);
  const activeSpanRef = useRef<HTMLSpanElement | null>(null);
  const [selection, setSelection] = useState<selectionType | null>(null);
  const [storedComments, setStoredComments] = useState<storedCommentsType[]>(
    [],
  );
  const [activeCommentId, setActiveCommentId] = useState<string | undefined>();

  const getCommentsData = useAppSelector((state) => state.comments.comments);

  useEffect(() => {
    if (artifactJobID) {
      dispatch(fetchComments(artifactJobID));
    }
  }, []);

  useEffect(() => {
    if (getCommentsData?.jobId !== artifactJobID) {
      setStoredComments([]);
      return;
    }
    const existingComments = getCommentsData?.data.map((com) => ({
      id: com.id,
      position: {
        left: com.position.left,
        top: com.position.top,
      },
      rowIndex: com.rowIndex,
      colField: com.colField,
      text: com.text,
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
    setStoredComments(existingComments);
  }, [getCommentsData, artifactJobID]);
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
    if (artifactJobID) {
      dispatch(fetchComments(artifactJobID));
    }
  }, [uploadCommentData?.data]);
  useEffect(() => {
    if (deletedCommentsData?.message === "OK" && artifactJobID) {
      dispatch(fetchComments(artifactJobID));
    }
    if (updatedCommentData?.message === "OK" && artifactJobID) {
      dispatch(fetchComments(artifactJobID));
    }
  }, [deletedCommentsData, updatedCommentData]);

  const handlePreviewMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!isShowComments) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return;

      const selectedText = sel.toString().trim();

      let slateRange: Range | null = null;
      try {
        slateRange = ReactEditor.toSlateRange(editor, sel, {
          exactMatch: false,
          suppressThrow: true,
        });
      } catch {
        /* ignore */
      }

      if (!slateRange || Range.isCollapsed(slateRange)) return;

      const domRange = sel.getRangeAt(0);
      const pageEl = pageRef.current;
      if (!pageEl) return;
      const pageRect = pageEl.getBoundingClientRect();

      const rects = Array.from(domRange.getClientRects());
      const lastRect =
        rects.length > 0
          ? rects[rects.length - 1]
          : domRange.getBoundingClientRect();

      const BOX_WIDTH = 250;
      const boxTop = lastRect.bottom - pageRect.top + 10;
      const rawLeft = lastRect.right - pageRect.left - BOX_WIDTH + 16;
      const boxLeft = Math.max(
        8,
        Math.min(rawLeft, pageRect.width - BOX_WIDTH - 8),
      );

      setSelection({
        position: {
          left: boxLeft,
          top: boxTop,
        },
        text: selectedText,
        slateRange,
      });
    },
    [editor, isShowComments],
  );

  // Keep callbacks in refs to avoid stale closures
  const onSaveRef = useRef(onClickSaveBtn);
  onSaveRef.current = onClickSaveBtn;
  const onDiscardRef = useRef(onDiscard);
  onDiscardRef.current = onDiscard;

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
      if (!value) {
        setInternalValue(val);
      }
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
          return (
            <h1 {...attributes} style={style}>
              {children}
            </h1>
          );
        case "heading-two":
          return (
            <h2 {...attributes} style={style}>
              {children}
            </h2>
          );
        case "heading-three":
          return (
            <h3 {...attributes} style={style}>
              {children}
            </h3>
          );
        case "heading-four":
          return (
            <h4 {...attributes} style={style}>
              {children}
            </h4>
          );
        case "heading-five":
          return (
            <h5
              {...attributes}
              style={style}
              className={element.className || "heading-five"}
            >
              {children}
            </h5>
          );
        case "heading-six":
          return (
            <h6 {...attributes} style={style}>
              {children}
            </h6>
          );
        case "bulleted-list":
          return (
            <ul {...attributes} style={style}>
              {children}
            </ul>
          );
        case "numbered-list":
          return (
            <ol {...attributes} style={style}>
              {children}
            </ol>
          );
        case "list-item":
          return (
            <li {...attributes} style={style}>
              {children}
            </li>
          );

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
              style={{
                background: "#f5f5f5",
                padding: 12,
                ...style,
              }}
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
          return (
            <tr {...attributes} style={style}>
              {children}
            </tr>
          );
        case "table-cell-header":
          return (
            <th {...attributes} style={style}>
              {children}
            </th>
          );
        case "table-cell":
          if (element.isHeader) {
            return (
              <th {...attributes} style={style}>
                {children}
              </th>
            );
          }
          return (
            <td {...attributes} style={style}>
              {children}
            </td>
          );
        case "paragraph":
          return (
            <p
              {...attributes}
              style={{ ...style }}
              className={element.className || "paragraph"}
            >
              {children}
            </p>
          );
        default:
          return (
            <p
              {...attributes}
              style={style}
              className={element.className || "paragraph"}
            >
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

  return (
    <>
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
            <div
              ref={pageRef}
              style={{ position: "relative" }}
              onMouseUp={isPreview ? handlePreviewMouseUp : undefined}
            >
              <Editable
                renderLeaf={renderLeaf}
                renderElement={renderElement}
                readOnly={isPreview}
                onKeyDown={!isPreview ? handleKeyDown : undefined}
                spellCheck={!isPreview}
                autoFocus={!isPreview}
                className={clsx(styles.editableArea, className)}
              />
              {selection && (
                <FloatingCommentToolbar
                  position={selection.position}
                  onAddComment={(text) => {
                    if (!selection) return;
                    sendComment(text);
                  }}
                />
              )}
            </div>
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
          />
        )}
      </div>
    </>
  );
};

export default SlateContentEditor;
