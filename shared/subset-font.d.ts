declare module "subset-font" {
  export default function subsetFont(
    font: Buffer,
    text: string,
  ): Promise<Buffer>;
}
