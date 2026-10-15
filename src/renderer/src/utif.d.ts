// UTIF.js (MIT) has no type declarations; this covers what is used.
declare module 'utif' {
  interface IFD {
    width: number
    height: number
    [key: string]: unknown
  }
  const UTIF: {
    decode(buffer: ArrayBuffer): IFD[]
    decodeImage(buffer: ArrayBuffer, ifd: IFD): void
    toRGBA8(ifd: IFD): Uint8Array
    encodeImage(rgba: Uint8Array | ArrayBuffer, width: number, height: number, metadata?: unknown): ArrayBuffer
  }
  export default UTIF
}
