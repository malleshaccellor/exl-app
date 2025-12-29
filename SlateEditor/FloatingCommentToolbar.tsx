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
const TOOLBAR_HEIGHT = 24;
const OFFSET = 8;
const EDGE_PADDING = 12;

export const FloatingCommentToolbar = ({
  editor,
  containerRef,
  onAddComment,
}: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [style, setStyle] = useState<React.CSSProperties | null>(null);

  useLayoutEffect(() => {
    const selection = editor.selection;
    const container = containerRef.current;
    const toolbar = ref.current;

    if (!selection || !Range.isExpanded(selection) || !container) {
      return;
    }

    const domRange = ReactEditor.toDOMRange(editor, selection);
    const rangeRect = domRange.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const toolbarWidth = toolbar?.offsetWidth ?? TOOLBAR_WIDTH;

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
  }, [editor.selection, containerRef, open, editor]);

  if (!style) return null;

  return (
    <div ref={ref} style={style} className={styles.floatingToolbar}>
      {!open ? (
        <IconButton
          size="small"
          className={styles.addCommentButton}
          onMouseDown={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
        >
          <SVG src="/icons/editor/ic_chat-circle.svg" />
        </IconButton>
      ) : (
        <div
          onMouseDown={(e) => e.preventDefault()}
          className={styles.commentInput}
        >
          <textarea
            autoFocus
            name="add-comment"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add comment…"
            rows={2}
          />
          <IconButton
            className={styles.sendButton}
            onMouseDown={(e) => {
              e.preventDefault();
              onAddComment(text);
              setText("");
              setOpen(false);
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
