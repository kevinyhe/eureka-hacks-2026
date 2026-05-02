import * as THREE from 'three';

export class Ring {
    constructor() {}

    init(scene, camera) {
        // Floor / Canvas
        const floorGeo = new THREE.PlaneGeometry(8, 8);
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#222222';
        ctx.fillRect(0, 0, 1024, 1024);
        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 2;
        for (let i = 0; i < 1024; i += 64) {
            ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 1024); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(1024, i); ctx.stroke();
        }

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.moveTo(512, 0);
        ctx.lineTo(512, 1024);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(512, 512, 450, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#ff0000';
        ctx.fillRect(862, 862, 100, 100);
        ctx.fillRect(62, 862, 100, 100);

        ctx.fillStyle = '#0000ff';
        ctx.fillRect(862, 62, 100, 100);
                ctx.fillRect(62, 62, 100, 100);
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        const floorMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0.1 });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);

        const postGeo = new THREE.CylinderGeometry(0.1, 0.12, 1.8, 16);
        const postMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
        const padGeo = new THREE.BoxGeometry(0.3, 0.8, 0.3);
        const padMatRed = new THREE.MeshStandardMaterial({ color: 0xaa0000, roughness: 0.7 });
        const padMatBlue = new THREE.MeshStandardMaterial({ color: 0x0000aa, roughness: 0.7 });

        const postPositions = [[-3.8, -3.8], [3.8, 3.8], [-3.8, 3.8], [3.8, -3.8]];
        postPositions.forEach((pos, idx) => {
            const post = new THREE.Mesh(postGeo, postMat);
            post.position.set(pos[0], 0.9, pos[1]);
            post.castShadow = true;
            scene.add(post);

            const pad = new THREE.Mesh(padGeo, (idx == 1 || idx == 2) ? padMatRed : padMatBlue);
            pad.position.set(pos[0], 1.1, pos[1]);
            pad.castShadow = true;
            scene.add(pad);
        });

        const ropeHeights = [0.5, 0.9, 1.2, 1.5];
        const ropeMatRed = new THREE.MeshStandardMaterial({ color: 0xbb0000, roughness: 0.9 });
        const ropeMatWhite = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.9 });
        const corners = [
            new THREE.Vector3(-3.8, 0, -3.8), new THREE.Vector3(3.8, 0, -3.8),
            new THREE.Vector3(3.8, 0, 3.8), new THREE.Vector3(-3.8, 0, 3.8), new THREE.Vector3(-3.8, 0, -3.8)
        ];

        ropeHeights.forEach((h, i) => {
            const mat = (i % 2 === 0) ? ropeMatRed : ropeMatWhite;
            for (let c = 0; c < 4; c++) {
                const start = corners[c].clone().setY(h);
                const end = corners[c + 1].clone().setY(h);
                const mid1 = start.clone().lerp(end, 0.33); mid1.y -= 0.05;
                const mid2 = start.clone().lerp(end, 0.66); mid2.y -= 0.05;
                const curve = new THREE.CatmullRomCurve3([start, mid1, mid2, end]);
                const tubeGeo = new THREE.TubeGeometry(curve, 20, 0.02, 8, false);
                const tube = new THREE.Mesh(tubeGeo, mat);
                tube.castShadow = true;
                scene.add(tube);
            }
        });

        const spot1 = new THREE.SpotLight(0xffeedd, 500); spot1.position.set(-2, 6, -2); spot1.castShadow = true; scene.add(spot1);
        const spot2 = new THREE.SpotLight(0xffeedd, 500); spot2.position.set(2, 6, 2); spot2.castShadow = true; scene.add(spot2);
        scene.add(new THREE.AmbientLight(0xccddff, 0.2));

        const rectPositions = [
            { p: [0, 2, -6], r: [0, 0, 0] }, { p: [0, 2, 6], r: [0, Math.PI, 0] },
            { p: [-6, 2, 0], r: [0, -Math.PI/2, 0] }, { p: [6, 2, 0], r: [0, Math.PI/2, 0] }
        ];
        rectPositions.forEach(rp => {
            const rectLight = new THREE.RectAreaLight(0xffffff, 2, 10, 4);
            rectLight.position.set(rp.p[0], rp.p[1], rp.p[2]);
            rectLight.rotation.set(rp.r[0], rp.r[1], rp.r[2]);
            scene.add(rectLight);
        });

        if (camera) { camera.position.set(-2.5, 1.7, 2.5); camera.lookAt(0.5, 1.5, -0.5); }
    }

    update(dt) {}
}
