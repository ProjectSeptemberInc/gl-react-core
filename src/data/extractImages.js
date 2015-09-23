function extractImages (uniforms) {
  const images = [];
  for (let u in uniforms) {
    let value = uniforms[u];
    if (value &&
      typeof value === "object" &&
      value.type === "image" &&
      value.value &&
      typeof value.value.uri === "string") {
      images.push(value.value);
    }
  }
  return images;
}

module.exports = extractImages;
