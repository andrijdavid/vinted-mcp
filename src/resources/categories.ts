import snapshot from "../visual/catalog-snapshot.json";
export const categoriesResource = {
  uri: "vinted://categories", name: "Vinted Categories",
  description: "Verified public Vinted men's category tree (snapshot 2026-11-09); country-specific changes remain possible",
  mimeType: "application/json"
};
export function getCategoriesData(): string {
  const nodes: any[] = snapshot.men;
  const build = (id: number, name: string): any => ({ id, name, children: nodes.filter(n => n.parentId === id).map(n => build(n.id, n.title)) });
  return JSON.stringify([{
    ...build(5, "Men"), source: snapshot.source, retrievedAt: snapshot.retrievedAt,
    note: "Only verified men's garment categories are included. Previous approximate IDs were removed."
  }]);
}
