export function formatStorePrice(price: number | null | undefined): string {
  if (price == null || Number.isNaN(price)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(price);
}
