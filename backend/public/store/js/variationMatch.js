// Matching algorithm shared with the server's lib/variationHelpers.js attributeKey()
// and already proven in views/product-demo.html — kept identical so client and
// server always agree on which variation a set of selected attributes points to.
function attributeKey(pairs) {
  return pairs
    .map(p => `${String(p.name).trim().toLowerCase()}:${String(p.value).trim().toLowerCase()}`)
    .sort()
    .join('|');
}

function findMatchingVariation(product, selectedAttributes) {
  const key = attributeKey(selectedAttributes);
  return product.variations.find(v => v.key === key) || null;
}
