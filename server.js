import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname( fileURLToPath( import.meta.url ) );

const app = express();
app.use( express.static( join( __dirname, 'dist' ) ) );
app.get( '*', ( _req, res ) => res.sendFile( join( __dirname, 'dist', 'index.html' ) ) );

const httpServer = createServer( app );
const io = new Server( httpServer, { cors: { origin: '*' } } );

const rooms = new Map();

function genId() {
	return Math.random().toString( 36 ).slice( 2, 8 ).toUpperCase();
}

function getPlayers( room ) {
	return [ ...room.players.entries() ].map( ( [ id, p ] ) => ( {
		id, ...p, isHost: id === room.host
	} ) );
}

function roomList() {
	// Purge rooms whose sockets are no longer connected (zombie cleanup)
	for ( const [ id, room ] of rooms ) {
		for ( const sid of room.players.keys() ) {
			if ( ! io.sockets.sockets.has( sid ) ) room.players.delete( sid );
		}
		if ( room.players.size === 0 ) rooms.delete( id );
	}
	return [ ...rooms.values() ].map( r => ( {
		id: r.id,
		playerCount: r.players.size,
		map: r.map,
		laps: r.laps,
		state: r.state,
	} ) );
}

function broadcastRooms() {
	io.emit( 'rooms:list', roomList() );
}

io.on( 'connection', socket => {

	// Send current room list immediately to the new client
	socket.emit( 'rooms:list', roomList() );

	// Allow client to request a fresh list at any time
	socket.on( 'rooms:get', () => socket.emit( 'rooms:list', roomList() ) );

	// ── Create room ────────────────────────────────────────────────────────

	socket.on( 'room:create', ( { name, map }, cb ) => {

		const id = genId();
		const room = {
			id,
			host: socket.id,
			players: new Map( [ [ socket.id, { name: name || 'Player', color: 'yellow' } ] ] ),
			map: map || null,
			laps: 3,
			state: 'lobby',
		};

		rooms.set( id, room );
		socket.join( id );
		socket.data.roomId = id;

		cb?.( { ok: true, roomId: id, isHost: true, laps: room.laps, map: room.map, players: getPlayers( room ) } );
		broadcastRooms();

	} );

	// ── Join room ──────────────────────────────────────────────────────────

	socket.on( 'room:join', ( { roomId, name }, cb ) => {

		const room = rooms.get( roomId );
		if ( ! room ) return cb?.( { ok: false, error: 'Room not found' } );
		if ( room.state !== 'lobby' ) return cb?.( { ok: false, error: 'Race in progress' } );
		if ( room.players.size >= 4 ) return cb?.( { ok: false, error: 'Room is full' } );

		const taken = new Set( [ ...room.players.values() ].map( p => p.color ) );
		const color = [ 'green', 'purple', 'red' ].find( c => ! taken.has( c ) ) || 'green';

		room.players.set( socket.id, { name: name || 'Player', color } );
		socket.join( roomId );
		socket.data.roomId = roomId;

		socket.to( roomId ).emit( 'player:joined', { id: socket.id, name: name || 'Player', color } );

		cb?.( { ok: true, roomId, isHost: false, hostId: room.host, laps: room.laps, map: room.map, players: getPlayers( room ) } );
		broadcastRooms();

	} );

	// ── Host: change laps ──────────────────────────────────────────────────

	socket.on( 'room:set-laps', ( { laps } ) => {

		const room = rooms.get( socket.data.roomId );
		if ( ! room || room.host !== socket.id ) return;
		room.laps = laps;
		io.to( room.id ).emit( 'room:laps-changed', { laps } );

	} );

	// ── Host: start race ───────────────────────────────────────────────────

	socket.on( 'race:start', () => {

		const room = rooms.get( socket.data.roomId );
		if ( ! room || room.host !== socket.id ) return;
		room.state = 'racing';
		io.to( room.id ).emit( 'race:start', { laps: room.laps } );
		broadcastRooms();

	} );

	// ── Position relay ─────────────────────────────────────────────────────

	socket.on( 'player:update', data => {

		const roomId = socket.data.roomId;
		if ( roomId ) socket.to( roomId ).emit( 'player:update', { id: socket.id, ...data } );

	} );

	// ── Finish ─────────────────────────────────────────────────────────────

	socket.on( 'race:finish', ( { totalTime } ) => {

		const roomId = socket.data.roomId;
		if ( roomId ) socket.to( roomId ).emit( 'player:finished', { id: socket.id, totalTime } );

	} );

	// ── Disconnect ─────────────────────────────────────────────────────────

	socket.on( 'disconnect', () => {

		const roomId = socket.data.roomId;
		if ( ! roomId ) return;
		const room = rooms.get( roomId );
		if ( ! room ) return;

		room.players.delete( socket.id );
		io.to( roomId ).emit( 'player:left', { id: socket.id } );

		if ( room.players.size === 0 ) {

			rooms.delete( roomId );

		} else if ( room.host === socket.id ) {

			room.host = [ ...room.players.keys() ][ 0 ];
			io.to( roomId ).emit( 'room:host-changed', { hostId: room.host } );

		}

		broadcastRooms();

	} );

} );

const PORT = process.env.PORT || 3001;
httpServer.listen( PORT, () => {
	console.log( `Server running on :${ PORT }` );
} );
