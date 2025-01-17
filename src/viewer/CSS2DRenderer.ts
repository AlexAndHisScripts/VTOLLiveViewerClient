import * as THREE from "three";

// Handle the updating/rendering of 2D text overlays
class CSS2DRenderer {
	private _width = 0;
	private _height = 0;
	private _widthHalf = 0;
	private _heightHalf = 0;

	private vector: THREE.Vector3 = new THREE.Vector3();
	private viewMatrix = new THREE.Matrix4();
	private viewProjectionMatrix = new THREE.Matrix4();

	public domElement: HTMLDivElement;

	constructor() {
		this.domElement = document.createElement('div');
		this.domElement.className = "overlay-main";
		document.getElementById("main-container")?.appendChild(this.domElement);
	}

	public getSize() {
		return {
			width: this._width,
			height: this._height
		};
	}

	public setSize(width: number, height: number) {
		this._width = width;
		this._height = height;

		this._widthHalf = this._width / 2;
		this._heightHalf = this._height / 2;

		this.domElement.style.width = width + 'px';
		this.domElement.style.height = height + 'px';
	}

	private renderObject(object: CSS2DObject, camera: THREE.Camera, frustum: THREE.Frustum) {
		const element = object.element;
		const isVisible = frustum.containsPoint(object.position);
		element.style.visibility = isVisible ? "visible" : "hidden";

		if (isVisible) {
			this.vector.setFromMatrixPosition(object.matrixWorld);
			this.vector.applyMatrix4(this.viewProjectionMatrix);

			const style = 'translate(-50%,-50%) translate(' + (this.vector.x * this._widthHalf + this._widthHalf) + 'px,' + (-this.vector.y * this._heightHalf + this._heightHalf) + 'px)';

			element.style.transform = style;

			if (element.parentNode !== this.domElement) {
				this.domElement.appendChild(element);
			}
		}
	}

	public render(scene: THREE.Scene, camera: THREE.Camera, objects: CSS2DObject[]) {
		// These aren't super great for performance, possible todo to optimize
		scene.updateMatrixWorld();

		if (camera.parent === null) camera.updateMatrixWorld();

		this.viewMatrix.copy(camera.matrixWorldInverse);
		this.viewProjectionMatrix.multiplyMatrices(camera.projectionMatrix, this.viewMatrix);
		const frustum = new THREE.Frustum();
		frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));

		// this.renderObject(scene, camera, frustum);
		objects.forEach(obj => {
			this.renderObject(obj, camera, frustum);
		});
	}
}

class CSS2DObject extends THREE.Object3D {
	constructor(public element: HTMLElement) {
		super();

		this.element.style.position = "absolute";
		this.addEventListener('removed', () => {
			if (this.element.parentNode !== null) {
				this.element.parentNode.removeChild(this.element);
			}
		});
	}
}

export { CSS2DRenderer, CSS2DObject };