import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createWorldSettings, createWorld, addBroadphaseLayer, addObjectLayer, enableCollision, registerAll, updateWorld, rigidBody, box, MotionType } from 'crashcat';
import { Vehicle } from './Vehicle.js';
import { Camera } from './Camera.js';
import { Controls } from './Controls.js';
import { buildTrack, decodeCells, computeSpawnPosition, computeTrackBounds, TRACK_CELLS } from './Track.js';
import { buildWallColliders, createSphereBody } from './Physics.js';
import { SmokeTrails } from './Particles.js';
import { GameAudio } from './Audio.js';
import { Race } from './Race.js';
import { Multiplayer } from './Multiplayer.js';


const renderer = new THREE.WebGLRenderer( { antialias: true, outputBufferType: THREE.HalfFloatType } );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setPixelRatio( window.devicePixelRatio );
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const bloomPass = new UnrealBloomPass( new THREE.Vector2( window.innerWidth, window.innerHeight ) );
bloomPass.strength = 0.02;
bloomPass.radius = 0.02;
bloomPass.threshold = 0.5;

renderer.setEffects( [ bloomPass ] );
document.body.appendChild( renderer.domElement );

const scene = new THREE.Scene();
scene.background = new THREE.Color( 0xadb2ba );
scene.fog = new THREE.Fog( 0xadb2ba, 30, 55 );

const dirLight = new THREE.DirectionalLight( 0xffffff, 5 );
dirLight.position.set( 11.4, 15, - 5.3 );
dirLight.castShadow = true;
dirLight.shadow.mapSize.setScalar( 4096 );
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 60;
dirLight.shadow.camera.left = - 30;
dirLight.shadow.camera.right = 30;
dirLight.shadow.camera.top = 30;
dirLight.shadow.camera.bottom = - 30;
scene.add( dirLight );

const hemiLight = new THREE.HemisphereLight( 0xc8d8e8, 0x7a8a5a, 1.5 );
scene.add( hemiLight );

window.addEventListener( 'resize', () => renderer.setSize( window.innerWidth, window.innerHeight ) );

const loader = new GLTFLoader();
const modelNames = [
	'vehicle-truck-yellow', 'vehicle-truck-green', 'vehicle-truck-purple', 'vehicle-truck-red',
	'track-straight', 'track-corner', 'track-bump', 'track-finish',
	'decoration-empty', 'decoration-forest', 'decoration-tents',
];
const models = {};

async function loadModels() {

	await Promise.all( modelNames.map( name =>
		new Promise( ( resolve, reject ) => {

			loader.load( `models/${ name }.glb`, gltf => {

				gltf.scene.traverse( child => {
					if ( child.isMesh ) child.material.side = THREE.FrontSide;
				} );

				if ( name.startsWith( 'vehicle-' ) ) gltf.scene.scale.setScalar( 0.5 );

				models[ name ] = gltf.scene;
				resolve();

			}, undefined, reject );

		} )
	) );

}

function fmtTime( s ) {

	const m = Math.floor( s / 60 );
	const rem = s - m * 60;
	return `${ m }:${ rem.toFixed( 3 ).padStart( 6, '0' ) }`;

}

// ── Screen management ────────────────────────────────────────────────────────

function showScreen( id ) {

	document.querySelectorAll( '.overlay' ).forEach( el => el.classList.add( 'hidden' ) );
	if ( id ) document.getElementById( id )?.classList.remove( 'hidden' );

}

async function init() {

	registerAll();
	await loadModels();

	const mapParam = new URLSearchParams( window.location.search ).get( 'map' );
	let customCells = null;
	let spawnPos = null;

	if ( mapParam ) {

		try {

			customCells = decodeCells( mapParam );
			spawnPos = computeSpawnPosition( customCells );

		} catch {

			console.warn( 'Invalid map parameter, using default track' );

		}

	}

	const cells = customCells || TRACK_CELLS;

	const bounds = computeTrackBounds( customCells );
	const hw = bounds.halfWidth;
	const hd = bounds.halfDepth;
	const groundSize = Math.max( hw, hd ) * 2 + 20;
	const shadowExtent = Math.max( hw, hd ) + 10;

	dirLight.shadow.camera.left = - shadowExtent;
	dirLight.shadow.camera.right = shadowExtent;
	dirLight.shadow.camera.top = shadowExtent;
	dirLight.shadow.camera.bottom = - shadowExtent;
	dirLight.shadow.camera.updateProjectionMatrix();
	scene.fog.near = groundSize * 0.4;
	scene.fog.far = groundSize * 0.8;

	buildTrack( scene, models, customCells );

	const worldSettings = createWorldSettings();
	worldSettings.gravity = [ 0, - 9.81, 0 ];
	const BPL_MOVING = addBroadphaseLayer( worldSettings );
	const BPL_STATIC = addBroadphaseLayer( worldSettings );
	const OL_MOVING = addObjectLayer( worldSettings, BPL_MOVING );
	const OL_STATIC = addObjectLayer( worldSettings, BPL_STATIC );
	enableCollision( worldSettings, OL_MOVING, OL_STATIC );
	enableCollision( worldSettings, OL_MOVING, OL_MOVING );

	const world = createWorld( worldSettings );
	world._OL_MOVING = OL_MOVING;
	world._OL_STATIC = OL_STATIC;

	buildWallColliders( world, null, customCells );

	const roadHalf = groundSize / 2;
	rigidBody.create( world, {
		shape: box.create( { halfExtents: [ roadHalf, 0.01, roadHalf ] } ),
		motionType: MotionType.STATIC,
		objectLayer: OL_STATIC,
		position: [ bounds.centerX, - 0.125, bounds.centerZ ],
		friction: 5.0,
		restitution: 0.0,
	} );

	const sphereBody = createSphereBody( world, spawnPos );
	const vehicle = new Vehicle();
	vehicle.rigidBody = sphereBody;
	vehicle.physicsWorld = world;

	if ( spawnPos ) {

		vehicle.spherePos.set( spawnPos[ 0 ], spawnPos[ 1 ], spawnPos[ 2 ] );
		vehicle.prevModelPos.set( spawnPos[ 0 ], 0, spawnPos[ 2 ] );

	}

	const vehicleGroup = vehicle.init( models[ 'vehicle-truck-yellow' ] );
	scene.add( vehicleGroup );
	dirLight.target = vehicleGroup;

	const cam = new Camera( renderer );
	cam.targetPosition.copy( vehicle.spherePos );

	const controls = new Controls();
	const particles = new SmokeTrails( scene );
	const audio = new GameAudio();
	audio.init( cam.camera );

	const _fwd = new THREE.Vector3();
	const contactListener = {
		onContactAdded( bodyA, bodyB ) {
			if ( bodyA !== sphereBody && bodyB !== sphereBody ) return;
			_fwd.set( 0, 0, 1 ).applyQuaternion( vehicle.container.quaternion ).normalize();
			_fwd.y = 0;
			audio.playImpact( Math.abs( vehicle.modelVelocity.dot( _fwd ) ) );
		}
	};

	// ── Race & multiplayer state ─────────────────────────────────────────────

	const race = new Race( cells );
	let mp = null;
	let selectedLaps = 3;
	let lobbyLaps = 3;
	let finishShown = false;
	let finishSent = false;
	const mpPlayers = new Map(); // socketId → { name, color, totalTime, bestLapTime }
	let myName = 'Player';
	let myColor = 'yellow';

	// ── Back buttons ─────────────────────────────────────────────────────────

	document.querySelectorAll( '.btn-back' ).forEach( btn => {

		btn.addEventListener( 'click', () => showScreen( btn.dataset.back ) );

	} );

	// ── Welcome screen ───────────────────────────────────────────────────────

	document.getElementById( 'btn-solo-mode' ).addEventListener( 'click', () => {

		showScreen( 'screen-solo' );

	} );

	// ── Solo: lap selection ──────────────────────────────────────────────────

	document.querySelectorAll( '.lap-opt' ).forEach( btn => {

		btn.addEventListener( 'click', () => {

			document.querySelectorAll( '.lap-opt' ).forEach( b => b.classList.remove( 'active' ) );
			btn.classList.add( 'active' );
			selectedLaps = Number( btn.dataset.laps );

		} );

	} );

	document.getElementById( 'start-btn' ).addEventListener( 'click', () => {

		showScreen( null );
		startCountdown( selectedLaps );

	} );

	// ── Multiplayer button ───────────────────────────────────────────────────

	document.getElementById( 'btn-mp-mode' ).addEventListener( 'click', async () => {

		if ( ! mp ) {
			renderRooms( null );
			await connectMultiplayer();
		} else {
			mp.requestRooms();
		}
		showScreen( 'screen-mp' );

	} );

	// ── Create room ──────────────────────────────────────────────────────────

	document.getElementById( 'btn-create-room' ).addEventListener( 'click', async () => {

		if ( ! mp ) await connectMultiplayer();

		const name = document.getElementById( 'mp-name' ).value.trim() || 'Player';
		const res = await mp.createRoom( name, mapParam || null );

		if ( ! res?.ok ) return setMpStatus( res?.error || 'Failed to create room' );

		openLobby( res, true );

	} );

	// ── Refresh rooms ────────────────────────────────────────────────────────

	document.getElementById( 'btn-refresh-rooms' ).addEventListener( 'click', () => {

		renderRooms( null );
		mp?.requestRooms();

	} );

	// ── Lobby: lap selection (host) ──────────────────────────────────────────

	document.querySelectorAll( '.lobby-lap-opt' ).forEach( btn => {

		btn.addEventListener( 'click', () => {

			document.querySelectorAll( '.lobby-lap-opt' ).forEach( b => b.classList.remove( 'active' ) );
			btn.classList.add( 'active' );
			lobbyLaps = Number( btn.dataset.laps );
			mp?.setLaps( lobbyLaps );

		} );

	} );

	// ── Start race (host) ────────────────────────────────────────────────────

	document.getElementById( 'btn-start-mp' ).addEventListener( 'click', () => {

		mp?.startRace();
		// race:start event will fire for everyone including host

	} );

	// ── Finish screen ────────────────────────────────────────────────────────

	document.getElementById( 'play-again-btn' ).addEventListener( 'click', () => {

		window.location.reload();

	} );

	// ── Multiplayer helpers ──────────────────────────────────────────────────

	async function connectMultiplayer() {

		mp = new Multiplayer( { scene, models } );
		mp.connect();

		mp.onRoomsUpdate = rooms => renderRooms( rooms );

		mp.onPlayerJoined = ( id, name, color ) => {

			addLobbyPlayer( { id, name, color, isHost: false } );
			mpPlayers.set( id, { name, color, totalTime: null, bestLapTime: null } );

		};

		mp.onPlayerLeft = id => {

			document.querySelector( `.lobby-player[data-id="${ id }"]` )?.remove();
			mpPlayers.delete( id );

		};

		mp.onPlayerFinished = ( id, totalTime, bestLapTime ) => {

			const p = mpPlayers.get( id );
			if ( p ) { p.totalTime = totalTime; p.bestLapTime = bestLapTime; }
			if ( finishShown ) renderLeaderboard();

		};

		mp.onRaceStart = laps => {

			showScreen( null );
			startCountdown( laps );

		};

		mp.onLapsChanged = laps => {

			// Update lobby lap display for non-hosts when host changes laps
			document.querySelectorAll( '.lobby-lap-opt' ).forEach( b => {

				b.classList.toggle( 'active', Number( b.dataset.laps ) === laps );

			} );

		};

		mp.onHostChanged = hostId => {

			// Refresh host status indicators
			document.querySelectorAll( '.lobby-player' ).forEach( el => {

				el.querySelector( '.player-badge' ).textContent =
					el.dataset.id === hostId ? 'host' : '';

			} );

			if ( hostId === mp.socketId ) {

				document.getElementById( 'lobby-host-section' ).classList.remove( 'hidden' );
				document.getElementById( 'lobby-waiting-msg' ).classList.add( 'hidden' );

			}

		};

	}

	function renderRooms( rooms ) {

		const wrap = document.getElementById( 'room-list-wrap' );

		if ( ! rooms ) {

			wrap.innerHTML = '<div class="no-rooms">Loading…</div>';
			return;

		}

		const open = rooms.filter( r => r.state === 'lobby' );

		if ( open.length === 0 ) {

			wrap.innerHTML = '<div class="no-rooms">No open rooms</div>';
			return;

		}

		wrap.innerHTML = open.map( r => `
			<div class="room-row">
				<div class="room-info">
					<span class="room-id">${ r.id }</span>
					<span class="room-meta">${ r.laps } lap${ r.laps !== 1 ? 's' : '' } &middot; ${ r.playerCount }/4 players</span>
				</div>
				<button class="btn-join" data-room-id="${ r.id }" data-room-map="${ r.map || '' }">Join</button>
			</div>
		` ).join( '' );

		wrap.querySelectorAll( '.btn-join' ).forEach( btn => {

			btn.addEventListener( 'click', () => handleJoin( btn.dataset.roomId, btn.dataset.roomMap ) );

		} );

	}

	async function handleJoin( roomId, roomMap ) {

		if ( ! mp ) await connectMultiplayer();

		const name = document.getElementById( 'mp-name' ).value.trim() || 'Player';

		// If room uses a different map, reload with that map and auto-rejoin
		if ( roomMap && roomMap !== ( mapParam || '' ) ) {

			sessionStorage.setItem( 'mp-auto-join', JSON.stringify( { roomId, name } ) );
			window.location.href = '?map=' + roomMap;
			return;

		}

		const res = await mp.joinRoom( roomId, name );
		if ( ! res?.ok ) return setMpStatus( res?.error || 'Failed to join room' );

		openLobby( res, false );

	}

	function openLobby( res, isHost ) {

		document.getElementById( 'lobby-room-code' ).textContent = res.roomId;

		// Populate mpPlayers from the full player list
		mpPlayers.clear();
		for ( const p of res.players ) {

			if ( p.id !== mp.socketId ) {

				mpPlayers.set( p.id, { name: p.name, color: p.color, totalTime: null, bestLapTime: null } );

			} else {

				myName = p.name;
				myColor = p.color;

			}

		}

		const lobbyEl = document.getElementById( 'lobby-players' );
		lobbyEl.innerHTML = '';
		for ( const p of res.players ) addLobbyPlayer( { ...p, isHost: p.isHost || p.id === res.hostId } );

		const hostSec = document.getElementById( 'lobby-host-section' );
		const waitMsg = document.getElementById( 'lobby-waiting-msg' );
		hostSec.classList.toggle( 'hidden', ! isHost );
		waitMsg.classList.toggle( 'hidden', isHost );

		showScreen( 'screen-lobby' );

	}

	function addLobbyPlayer( { id, name, color, isHost } ) {

		const el = document.createElement( 'div' );
		el.className = 'lobby-player';
		el.dataset.id = id;
		el.innerHTML = `
			<div class="player-dot dot-${ color || 'yellow' }"></div>
			<span class="player-name">${ name }</span>
			<span class="player-badge">${ isHost ? 'host' : '' }</span>
		`;

		document.getElementById( 'lobby-players' ).appendChild( el );

	}

	function setMpStatus( msg ) {

		const el = document.getElementById( 'mp-status' );
		el.textContent = msg;
		setTimeout( () => { el.textContent = ''; }, 4000 );

	}

	// ── Auto-join on page load (after map redirect) ──────────────────────────

	const autoJoin = Multiplayer.checkAutoJoin();
	if ( autoJoin ) {

		showScreen( 'screen-mp' );
		document.getElementById( 'mp-name' ).value = autoJoin.name || '';
		await connectMultiplayer();
		const res = await mp.joinRoom( autoJoin.roomId, autoJoin.name );

		if ( res?.ok ) {

			openLobby( res, false );

		} else {

			setMpStatus( res?.error || 'Could not rejoin room' );

		}

	} else {

		showScreen( 'screen-welcome' );

	}

	// ── Countdown ────────────────────────────────────────────────────────────

	function startCountdown( laps ) {

		race.state = 'countdown';
		const el = document.getElementById( 'countdown' );
		el.classList.remove( 'hidden' );

		const steps = [ '3', '2', '1', 'GO!' ];
		let i = 0;

		function step() {

			el.textContent = steps[ i ];
			el.classList.toggle( 'go', steps[ i ] === 'GO!' );
			el.classList.remove( 'pop' );
			void el.offsetWidth;
			el.classList.add( 'pop' );
			i++;

			if ( i < steps.length ) {

				setTimeout( step, 1000 );

			} else {

				setTimeout( () => {

					el.classList.add( 'hidden' );
					document.getElementById( 'hud' ).classList.remove( 'hidden' );
					finishShown = false;
					race.startRace( laps );

				}, 700 );

			}

		}

		step();

	}

	// ── HUD ──────────────────────────────────────────────────────────────────

	function updateHUD() {

		document.getElementById( 'hud-lap' ).textContent =
			`LAP  ${ race.currentLap } / ${ race.totalLaps }`;
		document.getElementById( 'hud-time' ).textContent =
			fmtTime( race.currentLapTime );

		const best = race.bestLapTime;
		document.getElementById( 'hud-best' ).textContent =
			best !== null ? `BEST  ${ fmtTime( best ) }` : '';

	}

	function renderLeaderboard() {

		const isMP = !! mp?.roomId;
		const posLabels = [ '1ST', '2ND', '3RD' ];
		const posCls = [ 'pos-gold', 'pos-silver', 'pos-bronze' ];

		// Build entries list
		const me = {
			id: 'me',
			name: isMP ? myName : 'You',
			color: myColor,
			totalTime: race.elapsed,
			bestLapTime: race.bestLapTime,
			isMe: true,
			done: true,
		};

		let entries;
		if ( isMP ) {

			const others = [ ...mpPlayers.values() ].map( p => ( {
				...p, id: null, isMe: false, done: p.totalTime !== null,
			} ) );
			entries = [ me, ...others ];

		} else {

			entries = [ me ];

		}

		// Sort: finished by time first, then unfinished
		const finished = entries.filter( e => e.done ).sort( ( a, b ) => a.totalTime - b.totalTime );
		const racing   = entries.filter( e => ! e.done );
		const ranked   = [ ...finished, ...racing ];

		document.getElementById( 'finish-leaderboard' ).innerHTML = `
			<table class="leaderboard">
				<thead>
					<tr>
						<th>Pos</th>
						<th>Player</th>
						<th>Total</th>
						<th>Best Lap</th>
					</tr>
				</thead>
				<tbody>
					${ ranked.map( ( e, i ) => {
						const pos = e.done ? ( posLabels[ i ] || `${ i + 1 }TH` ) : '—';
						const cls = e.done ? ( posCls[ i ] || '' ) : '';
						return `<tr class="${ e.isMe ? 'lb-me' : '' } ${ ! e.done ? 'lb-racing' : '' }">
							<td class="lb-pos ${ cls }">${ pos }</td>
							<td class="lb-player"><span class="player-dot dot-${ e.color }"></span>${ e.name }</td>
							<td class="lb-time">${ e.done ? fmtTime( e.totalTime ) : 'Racing…' }</td>
							<td class="lb-best">${ e.bestLapTime != null ? fmtTime( e.bestLapTime ) : '—' }</td>
						</tr>`;
					} ).join( '' ) }
				</tbody>
			</table>
		`;

		// Lap-by-lap for local player
		const bestIdx = race.lapTimes.indexOf( Math.min( ...race.lapTimes ) );
		document.getElementById( 'finish-laps' ).innerHTML = race.lapTimes.map( ( t, i ) =>
			`<div class="lap-result${ i === bestIdx ? ' best' : '' }">Lap ${ i + 1 }  ${ fmtTime( t ) }</div>`
		).join( '' );

	}

	function showFinish() {

		if ( ! finishShown ) {

			finishShown = true;
			document.getElementById( 'hud' ).classList.add( 'hidden' );
			document.getElementById( 'finish' ).classList.remove( 'hidden' );

		}

		if ( mp?.roomId && ! finishSent ) {

			finishSent = true;
			mp.sendFinish( race.elapsed, race.bestLapTime );

		}

		renderLeaderboard();

	}

	// ── Game loop ────────────────────────────────────────────────────────────

	const timer = new THREE.Timer();

	function animate() {

		requestAnimationFrame( animate );
		timer.update();
		const dt = Math.min( timer.getDelta(), 1 / 30 );

		const rawInput = controls.update();
		const input = race.state === 'racing' ? rawInput : { x: 0, z: 0 };

		updateWorld( world, contactListener, dt );
		vehicle.update( dt, input );
		race.update( dt, vehicle.spherePos );

		// Multiplayer: broadcast position + update ghost lerp
		if ( mp?.roomId ) {

			mp.sendPosition( vehicle, race.currentLap );
			mp.update( dt );

		}

		if ( race.state === 'racing' ) {

			updateHUD();

		} else if ( race.state === 'finished' && ! finishShown ) {

			updateHUD();
			showFinish();

		}

		dirLight.position.set( vehicle.spherePos.x + 11.4, 15, vehicle.spherePos.z - 5.3 );
		cam.update( dt, vehicle.spherePos );
		particles.update( dt, vehicle );
		audio.update( dt, vehicle.linearSpeed, input.z, vehicle.driftIntensity );

		renderer.render( scene, cam.camera );

	}

	animate();

}

init();
