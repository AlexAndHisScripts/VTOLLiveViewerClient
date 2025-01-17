import * as THREE from "three";

import { Vector } from "../../../../VTOLLiveViewerCommon/dist/src/vector.js";
import { Application } from "../app";
import { entityMeshs } from "./entityMeshConfigs";
import { GLTFLoader } from "./GLTFLoader";
import InstancedGroupMesh from "./instancedGroupMesh";
import { OBJLoader } from "./OBJLoader";

interface IMeshOffsets {
	pos: Vector | null;
	rot: Vector | null;
}


// This needs looking at for performance.
// TODO: Check vts file for how many instances of each entity we need. The less IMesh's we have, the better.
const INSTANCE_MESH_COUNT = 128; // This might be too low! (or too high for many missions)
const IMESH_SKIPPED = [
	"Units/Allied/AlliedCarrier",
	"Units/Allied/AlliedAAShip",
	"Units/Allied/EscortCruiser",
	"Units/Allied/DroneCarrier",
	"Units/Allied/DroneGunBoat",
	"Units/Allied/DroneMissileCruiser",
	"Units/Allied/E-4",
	"Units/Enemy/EnemyCarrier",
	"Units/Enemy/EscortCruiser",
	"Units/Enemy/ESuperMissileCruiser",
];

// Handles loading all entity meshes
class MeshLoader {
	private objLoader: OBJLoader = new OBJLoader();
	private gltfLoader: GLTFLoader = new GLTFLoader();
	private cache: Record<string, THREE.Group> = {};
	private materialCache: Record<string, THREE.MeshStandardMaterial> = {};

	private instancedMeshCache: Record<string, { mesh: InstancedGroupMesh, lastId: number, size: number; }> = {};
	private currentLoadingQueue: Set<string> = new Set();
	private currentLoadingQueueCBs: Record<string, (() => void)[]> = {};

	private boundingBoxCache: Record<string, THREE.Box3> = {};

	public async load(entityKey: string): Promise<THREE.Group | null> {
		if (entityKey.includes("/Missiles/")) return null;
		if (this.cache[entityKey]) return this.cache[entityKey];

		const config = entityMeshs.find(e => e.key == entityKey);

		let path: string;
		if (config) {
			path = config.path;
		} else {
			const parts = entityKey.split("/");
			const name = parts[parts.length - 1];
			path = `./assets/objects/output/vtolvr_${name}.gltf`;
		}

		const loader = path.endsWith("gltf") ? this.gltfLoader : this.objLoader;
		let obj: unknown;
		try {
			// eslint-disable-next-line @typescript-eslint/no-empty-function
			obj = await new Promise((res, err) => loader.load(path, res, () => { }, err));
		} catch (e) {
			console.log(`Failed to load mesh from ${path} for ${entityKey}`, e);
			return null;
		}

		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore
		const objGroup = (path.endsWith("gltf") ? obj.scene : obj) as THREE.Group;
		let mat: THREE.MeshStandardMaterial;
		const color = config && config.color ? config.color : "#747474";
		if (this.materialCache[color]) mat = this.materialCache[color];
		else mat = new THREE.MeshStandardMaterial({ color: color, side: THREE.DoubleSide });

		objGroup.children.forEach(child => {
			if (child instanceof THREE.Mesh) {
				child.material = mat;
			}
		});
		objGroup.rotation.set(0, Math.PI, 0);
		if (config && config.position) objGroup.position.set(config.position.x, config.position.y, config.position.z);
		if (config && config.rotation) objGroup.rotation.set(config.rotation.x, config.rotation.y, config.rotation.z);
		if (config && config.loadScale) objGroup.scale.set(config.loadScale, config.loadScale, config.loadScale);

		const mesh = new THREE.Group();
		mesh.add(objGroup);

		return mesh;
	}

	// Gets the next instance of a mesh for this entity
	private getQueuedInstancedMesh(entityKey: string): { mesh: InstancedGroupMesh, id: number; } | null {
		const iMesh = this.instancedMeshCache[entityKey];
		const id = ++iMesh.lastId;
		if (id > iMesh.size) {
			console.log(`${entityKey} out of instances!`);
			return null;
		}
		return {
			mesh: iMesh.mesh,
			id: id
		};
	}

	public async loadInstancedMesh(entityKey: string): Promise<{ mesh: InstancedGroupMesh, id: number; } | null> {
		if (IMESH_SKIPPED.includes(entityKey)) return null;

		if (this.instancedMeshCache[entityKey]) {
			return this.getQueuedInstancedMesh(entityKey);
		}

		// If mesh is currently being loaded by another call, return a promise to that mesh
		if (this.currentLoadingQueue.has(entityKey)) {
			await new Promise<void>(res => {
				if (!this.currentLoadingQueueCBs[entityKey]) this.currentLoadingQueueCBs[entityKey] = [];
				this.currentLoadingQueueCBs[entityKey].push(res);
			});
			return this.getQueuedInstancedMesh(entityKey);
		}

		// We need to keep track of what we are currently loading so we don't load it twice
		this.currentLoadingQueue.add(entityKey);

		const config = entityMeshs.find(e => e.key == entityKey);

		let path: string;
		if (config) {
			path = config.path;
		} else {
			const parts = entityKey.split("/");
			const name = parts[parts.length - 1];
			path = `./assets/objects/output/vtolvr_${name}.gltf`;
		}

		// Determine what loader should be used and load the mesh
		const loader = path.endsWith("gltf") ? this.gltfLoader : this.objLoader;
		let obj: unknown;
		try {
			// eslint-disable-next-line @typescript-eslint/no-empty-function
			obj = await new Promise((res, err) => loader.load(path, res, () => { }, err));
		} catch (e) {
			console.log(`Failed to load mesh from ${path} for ${entityKey}`, e);
			return null;
		}

		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore
		const objGroup = (path.endsWith("gltf") ? obj.scene : obj) as THREE.Group;

		// Load material
		let mat: THREE.MeshStandardMaterial;
		const color = config && config.color ? config.color : "#747474";
		if (this.materialCache[color]) mat = this.materialCache[color];
		else mat = new THREE.MeshStandardMaterial({ color: color, side: THREE.DoubleSide });

		// Update material
		objGroup.children.forEach(child => {
			if (child instanceof THREE.Mesh) {
				child.material = mat;
			}
		});

		const meshGroup = new THREE.Group();
		meshGroup.add(objGroup);

		this.computeBoundingBox(meshGroup, entityKey);

		const iMesh = new InstancedGroupMesh(meshGroup, INSTANCE_MESH_COUNT);
		this.instancedMeshCache[entityKey] = { mesh: iMesh, lastId: 0, size: INSTANCE_MESH_COUNT };
		// Call the callback for anything waiting on this mesh
		this.currentLoadingQueueCBs[entityKey]?.forEach(cb => cb());
		this.currentLoadingQueueCBs[entityKey] = [];
		this.currentLoadingQueue.delete(entityKey);

		iMesh.name = 'InstancedMesh';
		iMesh.frustumCulled = false;

		Application.instance.sceneManager.add(iMesh);

		return {
			mesh: iMesh,
			id: 0
		};
	}

	private computeBoundingBox(mesh: THREE.Group, entityKey: string) {
		if (this.boundingBoxCache[entityKey]) return;
		const box = new THREE.Box3().setFromObject(mesh);
		this.boundingBoxCache[entityKey] = box;
	}

	// Normal mesh uses offsets assigned on load, IMesh can't so offsets are given to the entity for management
	public getOffsets(entityKey: string): IMeshOffsets {
		const config = entityMeshs.find(e => e.key == entityKey);
		if (!config) return { pos: null, rot: new Vector(0, Math.PI, 0) };
		return {
			pos: config.position ?? null,
			rot: config.rotation ?? new Vector(0, Math.PI, 0)
		};
	}

	public getBoundingBox(entityKey: string): THREE.Box3 {
		return this.boundingBoxCache[entityKey];
	}

	public getScaleDamper(entityKey: string) {
		const config = entityMeshs.find(em => em.key == entityKey);
		if (!config || !config.scaleDamper) return 1;

		return config.scaleDamper;
	}

	public getScale(entityKey: string) {
		const config = entityMeshs.find(em => em.key == entityKey);
		if (!config || !config.loadScale) return 1;

		return config.loadScale;
	}

	public getEngineOffsets(entityKey: string) {
		const config = entityMeshs.find(em => em.key == entityKey);
		if (!config || !config.engineOffsets) return null;

		return config.engineOffsets;
	}
}

export { MeshLoader, IMeshOffsets };