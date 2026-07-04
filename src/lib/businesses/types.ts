/** A business (shop/brand) the ecosystem operates. The primary business is the
 * currently wired shop (GotchaDayGoods); additional businesses are registered
 * here as the empire grows. Per-business pipeline isolation is a later phase. */
export type Business = {
  id: string;
  name: string;
  slug: string | null;
  niche: string | null;
  brand: string | null;
  status: string;
  isPrimary: boolean;
  createdAt: string;
};
