import * as THREE from 'three';

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export class QuadShader {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly material: THREE.ShaderMaterial;
  private geometry = new THREE.PlaneGeometry(2, 2);

  constructor(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader,
      uniforms,
    });
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  render(gl: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null): void {
    gl.setRenderTarget(target);
    gl.render(this.scene, this.camera);
  }

  dispose(): void {
    this.material.dispose();
    this.geometry.dispose();
  }
}
