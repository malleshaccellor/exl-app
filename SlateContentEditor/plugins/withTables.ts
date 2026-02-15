import { Editor, Transforms, Element as SlateElement } from "slate";

export const withTables = (editor: Editor): Editor => {
  const { deleteBackward, deleteForward, insertBreak } = editor;

  editor.deleteBackward = (unit) => {
    const { selection } = editor;
    if (selection) {
      const [cell] = Editor.nodes(editor, {
        match: (n) =>
          !Editor.isEditor(n) &&
          SlateElement.isElement(n) &&
          (n.type === "table-cell" || n.type === "table-cell-header"),
      });
      if (cell) {
        const [, cellPath] = cell;
        if (Editor.isStart(editor, selection.anchor, cellPath)) return;
      }
    }
    deleteBackward(unit);
  };

  editor.deleteForward = (unit) => {
    const { selection } = editor;
    if (selection) {
      const [cell] = Editor.nodes(editor, {
        match: (n) =>
          !Editor.isEditor(n) &&
          SlateElement.isElement(n) &&
          (n.type === "table-cell" || n.type === "table-cell-header"),
      });
      if (cell) {
        const [, cellPath] = cell;
        if (Editor.isEnd(editor, selection.anchor, cellPath)) return;
      }
    }
    deleteForward(unit);
  };

  editor.insertBreak = () => {
    const [cell] = Editor.nodes(editor, {
      match: (n) =>
        !Editor.isEditor(n) &&
        SlateElement.isElement(n) &&
        (n.type === "table-cell" || n.type === "table-cell-header"),
    });
    if (cell) {
      Transforms.insertNodes(editor, {
        type: "paragraph",
        children: [{ text: "" }],
      });
      return;
    }
    insertBreak();
  };

  return editor;
};
