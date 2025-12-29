import { IconButton } from "@mui/material";
import SVG from "react-inlinesvg";
import { Editor, Transforms, Element as SlateElement } from "slate";
import { useSlate } from "slate-react";
import styles from "./slate-editor.module.css";
import CustomButton from "../CustomButton/CustomButton";

const isAlignActive = (editor: Editor, align: string) => {
  const [match] = Editor.nodes(editor, {
    match: (n) => SlateElement.isElement(n) && n.align === align,
  });

  return !!match;
};

const toggleMark = (editor: Editor, format: string) => {
  const isActive = Editor.marks(editor)?.[format] === true;
  if (isActive) {
    Editor.removeMark(editor, format);
  } else {
    Editor.addMark(editor, format, true);
  }
};

const toggleAlign = (editor: Editor, align: "left" | "center" | "right") => {
  const isActive = isAlignActive(editor, align);
  Transforms.setNodes(
    editor,
    { align: isActive ? undefined : align },
    {
      match: (n) => SlateElement.isElement(n) && Editor.isBlock(editor, n),
    }
  );
};

interface ToolbarProps {
  onClickSaveBtn?: () => void;
  buttonLabel?: string;
}

export const Toolbar = ({ onClickSaveBtn, buttonLabel }: ToolbarProps) => {
  const editor = useSlate();

  return (
    <div className={styles.toolbarContainer}>
      <div className={styles.inlineMarks}>
        <IconButton
          onMouseDown={(e) => {
            e.preventDefault();
            toggleMark(editor, "bold");
          }}
          aria-label="bold"
        >
          <SVG src="/icons/editor/ic_bold.svg" width={16} height={16} />
        </IconButton>
        <div className={styles.divider}></div>
        <IconButton
          onMouseDown={(e) => {
            e.preventDefault();
            toggleMark(editor, "italic");
          }}
          aria-label="italic"
        >
          <SVG src="/icons/editor/ic_italic.svg" width={16} height={16} />
        </IconButton>
        <div className={styles.divider}></div>
        <IconButton
          onMouseDown={(e) => {
            e.preventDefault();
            toggleMark(editor, "underline");
          }}
          aria-label="underline"
        >
          <SVG src="/icons/editor/ic_underline.svg" width={16} height={16} />
        </IconButton>
        <div className={styles.divider}></div>
        <IconButton
          onMouseDown={(e) => {
            e.preventDefault();
            toggleMark(editor, "strikethrough");
          }}
          aria-label="strikethrough"
        >
          <SVG
            src="/icons/editor/ic_strikethrough.svg"
            width={16}
            height={16}
          />
        </IconButton>
      </div>
      <div className={styles.inlineMarks}>
        <IconButton
          onMouseDown={(e) => {
            e.preventDefault();
            toggleAlign(editor, "left");
          }}
          aria-label="left align"
        >
          <SVG
            src="/icons/editor/ic_left_align_text.svg"
            width={16}
            height={16}
          />
        </IconButton>
        <div className={styles.divider}></div>
        <IconButton
          onMouseDown={(e) => {
            e.preventDefault();
            toggleAlign(editor, "center");
          }}
          aria-label="center align"
        >
          <SVG
            src="/icons/editor/ic_center_align_text.svg"
            width={16}
            height={16}
          />
        </IconButton>
        <div className={styles.divider}></div>
        <IconButton
          onMouseDown={(e) => {
            e.preventDefault();
            toggleAlign(editor, "right");
          }}
          aria-label="right align"
        >
          <SVG
            src="/icons/editor/ic_right_align_text.svg"
            width={16}
            height={16}
          />
        </IconButton>
      </div>
      {onClickSaveBtn && (
        <div className={styles.saveButtonContainer}>
          <CustomButton onClick={onClickSaveBtn} size="small">
            {buttonLabel || "Save"}
          </CustomButton>
        </div>
      )}
    </div>
  );
};

export default Toolbar;
