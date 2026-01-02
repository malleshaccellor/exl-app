import { IconButton } from "@mui/material";
import { useLayoutEffect, useRef, useState } from "react";
import { Range } from "slate";
import { ReactEditor } from "slate-react";
import SVG from "react-inlinesvg";
import styles from "./slate-editor.module.css";

type Props = {
  editor: ReactEditor;
  containerRef: React.RefObject<HTMLDivElement>;
  onAddComment: (text: string) => void;
};

const TOOLBAR_WIDTH = 260;
const TOOLBAR_HEIGHT = 94;
const OFFSET = 8;
const EDGE_PADDING = 12;

export const FloatingCommentToolbar = ({
  editor,
  containerRef,
  onAddComment,
}: Props) => {
  const ref = useRef<HTMLDivElement>(null);

  const [text, setText] = useState("");
  const [textAreaOpen, setTextAreaOpen] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties | null>(null);

  const selection = editor.selection;
  const hasExpandedSelection = !!selection && Range.isExpanded(selection);

  if (!hasExpandedSelection && textAreaOpen) {
    setTextAreaOpen(false);
  }

  useLayoutEffect(() => {
    if (!hasExpandedSelection) return;

    const container = containerRef.current;
    const toolbar = ref.current;
    if (!container || !toolbar) return;

    const domRange = ReactEditor.toDOMRange(editor, selection!);
    const rangeRect = domRange.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const toolbarWidth = toolbar.offsetWidth ?? TOOLBAR_WIDTH;

    const spaceAbove = rangeRect.top - containerRect.top;
    const spaceBelow = containerRect.bottom - rangeRect.bottom;

    const placeBelow = spaceAbove < TOOLBAR_HEIGHT && spaceBelow > spaceAbove;

    const top = placeBelow
      ? rangeRect.bottom - containerRect.top + OFFSET
      : rangeRect.top - containerRect.top - TOOLBAR_HEIGHT - OFFSET;

    let left = rangeRect.right - containerRect.left + OFFSET;

    const minLeft = EDGE_PADDING;
    const maxLeft = containerRect.width - toolbarWidth - EDGE_PADDING;

    left = Math.min(Math.max(left, minLeft), maxLeft);

    setStyle({ top, left });
  }, [hasExpandedSelection, selection, editor, containerRef]);

  useLayoutEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setTextAreaOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  if (!hasExpandedSelection) return null;

  return (
    <div
      ref={ref}
      style={style ?? { visibility: "hidden" }}
      className={styles.floatingToolbar}
      contentEditable={false}
      suppressContentEditableWarning
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <IconButton
        size="small"
        className={styles.addCommentButton}
        disableFocusRipple
        disableRipple
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          ReactEditor.focus(editor);
          setTextAreaOpen((v) => !v);
        }}
      >
        <SVG src="/icons/editor/ic_chat-circle.svg" />
      </IconButton>

      {textAreaOpen && (
        <div
          onMouseDown={(e) => e.preventDefault()}
          className={styles.commentInput}
        >
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add comment…"
            rows={2}
          />

          <IconButton
            className={styles.sendButton}
            disabled={!text.trim()}
            onMouseDown={(e) => {
              e.preventDefault();
              onAddComment(text);
              setText("");
              setTextAreaOpen(false);
            }}
          >
            <SVG src="/icons/editor/ic_send.svg" />
          </IconButton>
        </div>
      )}
    </div>
  );
};

export default FloatingCommentToolbar;
