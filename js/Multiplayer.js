import { io } from 'socket.io-client';
import * as THREE from 'three';

export class Multiplayer {

	constructor( { scene, models } ) {

		this._scene = scene;
		this._models = models;
		this._socket = null;
		this._roomId = null;
		this._isHost = false;
		this._ghosts = new Map(); // socketId → { mesh, targetPos, targetQuat, currentPos, currentQuat }
		this._broadcastTick = 0;

		// Event callbacks — set by main.js
		this.onRoomsUpdate = null;    // ( rooms[] ) => void
		this.onPlayerJoined = null;   // ( id, name, color ) => void
		this.onPlayerLeft = null;     // ( id ) => void
		this.onRaceStart = null;      // ( laps ) => void
		this.onLapsChanged = null;    // ( laps ) => void
		this.onHostChanged = null;    // ( hostId ) => void
		this.onPlayerFinished = null; // ( id, totalTime, bestLapTime ) => void

	}

	connect() {

		this._socket = io();

		this._socket.on( 'rooms:list', rooms => this.onRoomsUpdate?.( rooms ) );

		this._socket.on( 'player:joined', ( { id, name, color } ) => {

			this._addGhost( id, color );
			this.onPlayerJoined?.( id, name, color );

		} );

		this._socket.on( 'player:left', ( { id } ) => {

			this._removeGhost( id );
			this.onPlayerLeft?.( id );

		} );

		this._socket.on( 'player:update', ( { id, px, py, pz, qx, qy, qz, qw } ) => {

			const g = this._ghosts.get( id );
			if ( g ) {

				g.targetPos.set( px, py, pz );
				g.targetQuat.set( qx, qy, qz, qw );
				g.mesh.visible = true;

			}

		} );

		this._socket.on( 'player:finished', ( { id, totalTime, bestLapTime } ) => this.onPlayerFinished?.( id, totalTime, bestLapTime ) );
		this._socket.on( 'race:start', ( { laps } ) => this.onRaceStart?.( laps ) );

		this._socket.on( 'room:laps-changed', ( { laps } ) => this.onLapsChanged?.( laps ) );

		this._socket.on( 'room:host-changed', ( { hostId } ) => {

			if ( hostId === this._socket.id ) this._isHost = true;
			this.onHostChanged?.( hostId );

		} );

	}

	createRoom( name, map ) {

		return new Promise( resolve => {

			this._socket.emit( 'room:create', { name, map }, res => {

				if ( res?.ok ) {

					this._roomId = res.roomId;
					this._isHost = true;

				}

				resolve( res );

			} );

		} );

	}

	joinRoom( roomId, name ) {

		return new Promise( resolve => {

			this._socket.emit( 'room:join', { roomId, name }, res => {

				if ( res?.ok ) {

					this._roomId = res.roomId;
					this._isHost = false;

					// Create ghosts for players already in the room
					for ( const p of res.players ) {

						if ( p.id !== this._socket.id ) {

							this._addGhost( p.id, p.color );

						}

					}

				}

				resolve( res );

			} );

		} );

	}

	requestRooms() {

		this._socket?.emit( 'rooms:get' );

	}

	setLaps( laps ) {

		this._socket?.emit( 'room:set-laps', { laps } );

	}

	startRace() {

		this._socket?.emit( 'race:start' );

	}

	sendFinish( totalTime, bestLapTime ) {

		this._socket?.emit( 'race:finish', { totalTime, bestLapTime } );

	}

	// Call every frame from game loop; throttled internally to ~30 Hz
	sendPosition( vehicle, lap ) {

		if ( ! this._socket?.connected || ! this._roomId ) return;

		this._broadcastTick++;
		if ( this._broadcastTick < 2 ) return; // ~30 Hz at 60 fps
		this._broadcastTick = 0;

		const p = vehicle.container.position;
		const q = vehicle.container.quaternion;
		this._socket.emit( 'player:update', {
			px: p.x, py: p.y, pz: p.z,
			qx: q.x, qy: q.y, qz: q.z, qw: q.w,
			lap,
		} );

	}

	// Call every frame to interpolate ghost positions
	update( dt ) {

		const t = Math.min( 1, dt * 12 );
		for ( const g of this._ghosts.values() ) {

			g.currentPos.lerp( g.targetPos, t );
			g.currentQuat.slerp( g.targetQuat, t );
			g.mesh.position.copy( g.currentPos );
			g.mesh.quaternion.copy( g.currentQuat );

		}

	}

	_addGhost( id, color ) {

		if ( this._ghosts.has( id ) ) return;

		const key = `vehicle-truck-${ color }`;
		const src = this._models[ key ];
		if ( ! src ) return;

		const mesh = src.clone();
		mesh.visible = false; // hidden until first position packet
		mesh.traverse( c => { if ( c.isMesh ) { c.castShadow = true; c.receiveShadow = true; } } );
		this._scene.add( mesh );

		this._ghosts.set( id, {
			mesh,
			targetPos: new THREE.Vector3(),
			targetQuat: new THREE.Quaternion(),
			currentPos: new THREE.Vector3(),
			currentQuat: new THREE.Quaternion(),
		} );

	}

	_removeGhost( id ) {

		const g = this._ghosts.get( id );
		if ( g ) {

			this._scene.remove( g.mesh );
			this._ghosts.delete( id );

		}

	}

	get isHost() { return this._isHost; }
	get roomId() { return this._roomId; }
	get socketId() { return this._socket?.id; }

	// Check for pending auto-join stored during map redirect
	static checkAutoJoin() {

		const raw = sessionStorage.getItem( 'mp-auto-join' );
		if ( ! raw ) return null;
		sessionStorage.removeItem( 'mp-auto-join' );
		return JSON.parse( raw );

	}

}
