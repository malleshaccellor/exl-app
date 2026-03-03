import { useCallback, useMemo, useRef, useState } from "react";
import { createEditor, Editor, type Descendant } from "slate";
import { Slate, Editable, withReact } from "slate-react";
import { withHistory } from "slate-history";
import clsx from "clsx";
import Toolbar from "./Toolbar";
import { withTables } from "./plugins/withTables";
import { jsonToSlateValue } from "./utils/jsonConversion";
import type { textStyle } from "./types";
import styles from "./slate-editor.module.css";

interface SlateEditorProps {
  value?: Descendant[];
  defaultValue?: Descendant[];
  onChange?: (value: Descendant[]) => void;
  readOnly?: boolean;
  onClickSaveBtn?: (nodes: Descendant[]) => void;
  className?: string;
  data?: Record<string, any>;
  onDiscard?: () => void;
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
  readOnly,
  onClickSaveBtn,
  className,
  data,
  onDiscard,
}: SlateEditorProps) => {
  const editor = useMemo(
    () => withTables(withHistory(withReact(createEditor()))),
    [],
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
            <h5 {...attributes} style={style}>
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
            <p {...attributes} style={{ margin: "2px 0", ...style }}>
              {children}
            </p>
          );
        default:
          return (
            <p {...attributes} style={style}>
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
      <div className={styles.editorContainer}>
        <div className={styles.editorArea}>
          <Slate
            editor={editor}
            initialValue={editorValue}
            onChange={handleChange}
          >
            <Toolbar
              onClickSaveBtn={onClickSaveBtn ? handleSave : undefined}
              buttonLabel="Save"
              onDiscard={onDiscard ? handleDiscard : undefined}
            />
            <Editable
              renderLeaf={renderLeaf}
              renderElement={renderElement}
              readOnly={readOnly}
              onKeyDown={handleKeyDown}
              className={clsx(styles.editableArea, className)}
            />
          </Slate>
        </div>
      </div>
    </>
  );
};

export default SlateContentEditor;
