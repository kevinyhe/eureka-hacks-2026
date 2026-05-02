export class Reactions {
    constructor(scene, crowd) { 
        this.scene = scene;
        this.crowd = crowd;
        this.hits = [];
    }
    init() { }
    registerHit(force) {
        this.crowd.react(force);
        this.hits.push(Date.now());
        this.hits = this.hits.filter(t => Date.now() - t < 2000);
        if (this.hits.length >= 3) {
            this.crowd.setState('WILD');
        }
    }
    update(dt) { }
}