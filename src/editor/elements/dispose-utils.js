export function disposeObject3D(object) {
  object.traverse((node) => {
    if (node.geometry && typeof node.geometry.dispose === "function") {
      node.geometry.dispose();
    }

    if (node.material) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (material.map && typeof material.map.dispose === "function") {
          material.map.dispose();
        }
        if (typeof material.dispose === "function") {
          material.dispose();
        }
      }
    }
  });
}
