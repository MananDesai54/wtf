export interface RGBA { r: number; g: number; b: number; a: number }

export type DomElement =
  | { kind: 'rect'; x: number; y: number; w: number; h: number;
      bg?: RGBA; borderColor?: RGBA; borderWidth?: number; radius?: number }
  | { kind: 'text'; x: number; y: number; w: number; h: number;
      text: string; fontSize: number; fontWeight: number;
      color: RGBA; align: 'left' | 'center' | 'right'; wrap?: boolean }
  | { kind: 'image'; x: number; y: number; w: number; h: number;
      imageId: string; radius?: number }
  | { kind: 'svg'; x: number; y: number; w: number; h: number; svgId: string };

export interface DomCapture {
  width: number; height: number; truncated?: boolean;
  elements: DomElement[]; images: Record<string, string>;
  svgs: Record<string, string>;
}

export interface StoredDomCapture extends DomCapture {
  imageData: Record<string, { mime: string; base64: string }>;
}
