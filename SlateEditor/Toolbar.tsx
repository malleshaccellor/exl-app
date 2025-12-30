import {
  IconButton,
  InputAdornment,
  MenuItem,
  OutlinedInput,
  Select,
  type SelectChangeEvent,
} from "@mui/material";
import SVG from "react-inlinesvg";
import { Editor, Transforms, Element as SlateElement } from "slate";
import { useSlate } from "slate-react";
import CustomButton from "../CustomButton/CustomButton";
import React from "react";
import type { AlignType, textListStyle, textStyle } from "../../slate";
import styles from "./slate-editor.module.css";

// Toggle font size for the current block element
const toggleFontSize = (editor: Editor, fontSize: string) => {
  const [match] = Editor.nodes(editor, {
    match: (n) => SlateElement.isElement(n) && Editor.isBlock(editor, n),
  });
  if (match) {
    const newFontSize = fontSize === "" ? undefined : fontSize;
    Transforms.setNodes(
      editor,
      { fontSize: newFontSize },
      { match: (n) => SlateElement.isElement(n) && Editor.isBlock(editor, n) }
    );
  }
};

// Toggle mark (bold, italic, underline, strikethrough)
const toggleMark = (editor: Editor, format: textStyle) => {
  const isActive = Editor.marks(editor)?.[format] === true;
  if (isActive) {
    Editor.removeMark(editor, format);
  } else {
    Editor.addMark(editor, format, true);
  }
};

// Toggle list (bulleted-list, numbered-list)
const LIST_TYPES: textListStyle[] = ["numbered-list", "bulleted-list"];
const isBlockActive = (editor: Editor, type: string) => {
  const [match] = Editor.nodes(editor, {
    match: (n) => SlateElement.isElement(n) && n.type === type,
  });
  return !!match;
};

const toggleList = (editor: Editor, type: textListStyle) => {
  const isActive = isBlockActive(editor, type);

  Transforms.unwrapNodes(editor, {
    match: (n) =>
      SlateElement.isElement(n) && LIST_TYPES.includes(n.type as textListStyle),
    split: true,
  });

  Transforms.setNodes(
    editor,
    { type: "paragraph" },
    {
      match: (n) =>
        SlateElement.isElement(n) &&
        Editor.isBlock(editor, n) &&
        n.type === "list-item",
    }
  );

  if (!isActive) {
    Transforms.setNodes(
      editor,
      { type: "list-item" },
      {
        match: (n) =>
          SlateElement.isElement(n) &&
          Editor.isBlock(editor, n) &&
          n.type === "paragraph",
      }
    );

    Transforms.wrapNodes(editor, {
      type,
      children: [],
    });
  }
};

// Indent block
const MAX_INDENT = 8;
const indentBlock = (editor: Editor) => {
  const [match] = Editor.nodes(editor, {
    match: (n) => SlateElement.isElement(n) && Editor.isBlock(editor, n),
  });

  if (match) {
    const indent = Math.min(MAX_INDENT, (match[0] as any).indent + 1);
    Transforms.setNodes(
      editor,
      { indent },
      { match: (n) => SlateElement.isElement(n) && Editor.isBlock(editor, n) }
    );
  }
};

// Outdent block
const outdentBlock = (editor: Editor) => {
  const [match] = Editor.nodes(editor, {
    match: (n) => SlateElement.isElement(n) && Editor.isBlock(editor, n),
  });

  if (match) {
    const indent = Math.max(0, (match[0] as any).indent - 1);
    Transforms.setNodes(
      editor,
      { indent },
      { match: (n) => SlateElement.isElement(n) && Editor.isBlock(editor, n) }
    );
  }
};

// Toggle alignment
const toggleAlign = (editor: Editor, align: AlignType) => {
  const [match] = Editor.nodes(editor, {
    match: (n) => SlateElement.isElement(n) && Editor.isBlock(editor, n),
  });
  if (match) {
    Transforms.setNodes(editor, { align } as Record<string, AlignType>, {
      match: (n) => SlateElement.isElement(n) && Editor.isBlock(editor, n),
    });
  }
};

interface ToolbarProps {
  onClickSaveBtn?: () => void;
  buttonLabel?: string;
}

export const Toolbar = ({ onClickSaveBtn, buttonLabel }: ToolbarProps) => {
  const editor = useSlate();
  const [fontSize, setFontSize] = React.useState<string>("");

  return (
    <div className={styles.toolbarContainer}>
      <div className={styles.fontStyleContainer}>
        <Select
          size="small"
          displayEmpty
          value={fontSize}
          IconComponent={() => null}
          onMouseDown={(e) => e.preventDefault()} // keep editor focus
          onChange={(e: SelectChangeEvent) => {
            setFontSize(e.target.value);
            toggleFontSize(editor, e.target.value);
          }}
          name="font-size"
          className={styles.fontSizeSelect}
          MenuProps={{
            classes: {
              paper: styles.fontSizeMenu,
            },
          }}
          input={
            <OutlinedInput
              endAdornment={
                <InputAdornment position="end">
                  <SVG src="/icons/ic_arrow-down.svg" />
                </InputAdornment>
              }
            />
          }
        >
          <MenuItem value="" disabled>
            Size
          </MenuItem>
          <MenuItem value="12">12</MenuItem>
          <MenuItem value="14">14</MenuItem>
          <MenuItem value="16">16</MenuItem>
          <MenuItem value="18">18</MenuItem>
          <MenuItem value="24">24</MenuItem>
        </Select>
      </div>
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
            toggleList(editor, "bulleted-list");
          }}
          aria-label="bulleted-list"
        >
          <SVG src="/icons/editor/ic_bulletedlist.svg" width={16} height={16} />
        </IconButton>
        <div className={styles.divider}></div>
        <IconButton
          onMouseDown={(e) => {
            e.preventDefault();
            toggleList(editor, "numbered-list");
          }}
          aria-label="numbered-list"
        >
          <SVG src="/icons/editor/ic_numberedlist.svg" width={16} height={16} />
        </IconButton>
        <div className={styles.divider}></div>
        <IconButton
          onMouseDown={(e) => {
            e.preventDefault();
            indentBlock(editor);
          }}
          aria-label="indent"
        >
          <SVG src="/icons/editor/ic_indent.svg" width={16} height={16} />
        </IconButton>
        <div className={styles.divider}></div>
        <IconButton
          onMouseDown={(e) => {
            e.preventDefault();
            outdentBlock(editor);
          }}
          aria-label="Outdent"
        >
          <SVG src="/icons/editor/ic_outdent.svg" width={16} height={16} />
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
