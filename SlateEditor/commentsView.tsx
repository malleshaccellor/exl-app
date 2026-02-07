import { useCallback, useMemo, useState } from "react";
import { createEditor, type Descendant } from "slate";
import { Slate, Editable, withReact } from "slate-react";
import clsx from "clsx";
import { useSlateStore } from "./hooks/useCommentsStore";
import Toolbar from "./Toolbar";
import { markdownToSlate } from "./markdownToSlate";
import styles from "./slate-editor.module.css";

interface SlateEditorProps {
  readOnly?: boolean;
  onClickSaveBtn?: () => void;
  markdownFromApi?: any;
}

export const SlateEditor = ({
  readOnly,
  onClickSaveBtn,
  markdownFromApi,
}: SlateEditorProps) => {
  const editor = useMemo(() => withReact(createEditor()), []);
  const { content, setContent } = useSlateStore([]);

  const [editorValue, setEditorValue] = useState<Descendant[]>(markdownFromApi);

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
        paddingLeft: `${element.indent * 24}px`,
        fontSize: `${element.fontSize}px`,
      };

      switch (element.type) {
        case "heading-1":
          return (
            <h1 {...attributes} style={style}>
              {children}
            </h1>
          );
        case "heading-2":
          return (
            <h2 {...attributes} style={style}>
              {children}
            </h2>
          );
        case "heading-3":
          return (
            <h3 {...attributes} style={style}>
              {children}
            </h3>
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
                ...style,
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
            <table>
              <tbody {...attributes}>{children}</tbody>
            </table>
          );
        case "table-row":
          return <tr {...attributes}>{children}</tr>;
        case "table-cell":
          return <td {...attributes}>{children}</td>;
        case "paragraph":
          return <p {...attributes}>{children}</p>;
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

  return (
    <>
      <div className={styles.editorContainer}>
        <div className={styles.editorArea}>
          <Slate
            editor={editor}
            initialValue={editorValue}
            onChange={() => {
              setContent(editor.children as Descendant[]);
            }}
          >
            <Toolbar onClickSaveBtn={onClickSaveBtn} buttonLabel="Save" />
            <Editable
              renderLeaf={renderLeaf}
              renderElement={renderElement}
              readOnly={readOnly}
              className={clsx(styles.editableArea)}
            />
          </Slate>
        </div>
      </div>
    </>
  );
};

export default SlateEditor;
