import * as THREE from 'three';
export class CameraManager {
    constructor(camera, crowd) { 
        this.camera = camera;
        this.crowd = crowd;
    }
    init() { }
    knockout() {
        this.crowd.setState('KNOCKOUT_REACTION');
    }
    update(dt) { }
}
