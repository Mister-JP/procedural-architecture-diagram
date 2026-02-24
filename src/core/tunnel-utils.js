import * as THREE from "three";

function createRectCorners(center, width, height) {
  const halfWidth = width * 0.5;
  const halfHeight = height * 0.5;

  return {
    topLeft: new THREE.Vector3(center.x - halfWidth, center.y + halfHeight, center.z),
    topRight: new THREE.Vector3(center.x + halfWidth, center.y + halfHeight, center.z),
    bottomRight: new THREE.Vector3(center.x + halfWidth, center.y - halfHeight, center.z),
    bottomLeft: new THREE.Vector3(center.x - halfWidth, center.y - halfHeight, center.z)
  };
}

function buildQuadGeometry(a, b, c, d) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array([
    a.x, a.y, a.z,
    b.x, b.y, b.z,
    c.x, c.y, c.z,
    a.x, a.y, a.z,
    c.x, c.y, c.z,
    d.x, d.y, d.z
  ]);

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Builds a translucent tunnel using four quad planes between two rectangles.
 *
 * @param {object} options - Tunnel options.
 * @param {THREE.Vector3} options.startCenter - Start rectangle center.
 * @param {number} options.startWidth - Start rectangle width.
 * @param {number} options.startHeight - Start rectangle height.
 * @param {THREE.Vector3} options.endCenter - End rectangle center.
 * @param {number} options.endWidth - End rectangle width.
 * @param {number} options.endHeight - End rectangle height.
 * @param {number} options.color - Tunnel color.
 * @param {number} [options.opacity=0.2] - Tunnel opacity.
 * @returns {THREE.Group} Group containing four quad meshes.
 */
export function createTunnelPlanes({
  startCenter,
  startWidth,
  startHeight,
  endCenter,
  endWidth,
  endHeight,
  color,
  opacity = 0.2
}) {
  const start = createRectCorners(startCenter, startWidth, startHeight);
  const end = createRectCorners(endCenter, endWidth, endHeight);

  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  const planeCornerSets = [
    [start.topLeft, start.topRight, end.topRight, end.topLeft],
    [start.bottomLeft, start.bottomRight, end.bottomRight, end.bottomLeft],
    [start.topLeft, start.bottomLeft, end.bottomLeft, end.topLeft],
    [start.topRight, start.bottomRight, end.bottomRight, end.topRight]
  ];

  const group = new THREE.Group();
  for (const [a, b, c, d] of planeCornerSets) {
    group.add(new THREE.Mesh(buildQuadGeometry(a, b, c, d), material));
  }

  return group;
}
