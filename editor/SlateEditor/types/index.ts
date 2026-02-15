import type { BaseEditor } from "slate";
import { ReactEditor } from "slate-react";

export type AlignType = "left" | "center" | "right";
export type textStyle = "bold" | "italic" | "underline" | "strikethrough";
export type textListStyle = "bulleted-list" | "numbered-list";
export type CustomText = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  fontFamily?: string;
  fontSize?: string;
  commentId?: string;
  indent?: number;
};

type HeadingType = 
  | 'heading-one' 
  | 'heading-two' 
  | 'heading-three' 
  | 'heading-four' 
  | 'heading-five' 
  | 'heading-six';

type ParagraphElement = {
  type: "paragraph";
  indent?: number;
  align?: AlignType;
  children: CustomText[];
};

type ListItemElement = {
  type: "list-item";
  indent?: number;
  children: CustomText[];
};

type BulletedListElement = {
  type: "bulleted-list";
  indent?: number;
  children: ListItemElement[];
};

type NumberedListElement = {
  type: "numbered-list";
  indent?: number;
  children: ListItemElement[];
};

type TableCellElement = {
  type: "table-cell";
  children: CustomText[];
};

type TableRowElement = {
  type: "table-row";
  children: TableCellElement[];
};

type TableElement = {
  type: "table";
  children: TableRowElement[];
};

export type CustomElement =
  | ParagraphElement
  | ListItemElement
  | BulletedListElement
  | NumberedListElement
  | HeadingType
  | TableElement
  | TableRowElement
  | TableCellElement  

declare module "slate" {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor;
    Element: CustomElement;
    Text: CustomText;
  }
}