import { CELL_RAW, GRID_SCALE } from './Track.js';

const CELL_SIZE = CELL_RAW * GRID_SCALE;
const MIN_TRAVEL = CELL_SIZE * 0.5; // must travel this far before a crossing counts

export class Race {

	constructor( cells ) {

		const finish = cells.find( c => c[ 2 ] === 'track-finish' ) || cells[ 0 ];
		const gx = finish[ 0 ], gz = finish[ 1 ], orient = finish[ 3 ];

		const cx = ( gx + 0.5 ) * CELL_SIZE;
		const cz = ( gz + 0.5 ) * CELL_SIZE;

		// N-S track (orient 0 or 10): finish line at fixed Z → check Z axis
		// E-W track (orient 16 or 22): finish line at fixed X → check X axis
		this._axis = ( orient === 0 || orient === 10 ) ? 'z' : 'x';
		this._finishValue = this._axis === 'z' ? cz : cx;

		// Perpendicular axis — vehicle must be within the finish cell's bounds
		// to avoid counting crossings on other cells at the same grid row/column
		this._orthAxis = this._axis === 'z' ? 'x' : 'z';
		const orthCenter = this._axis === 'z' ? cx : cz;
		this._orthMin = orthCenter - CELL_SIZE * 0.6;
		this._orthMax = orthCenter + CELL_SIZE * 0.6;

		this.state = 'pre';   // 'pre' | 'countdown' | 'racing' | 'finished'
		this.totalLaps = 3;
		this.currentLap = 0;
		this.lapTimes = [];
		this._elapsed = 0;
		this._lapStart = 0;
		this._lastSide = null;
		this._maxDist = 0;

	}

	get elapsed() { return this._elapsed; }

	get currentLapTime() {

		return this._elapsed - this.lapTimes.reduce( ( a, b ) => a + b, 0 );

	}

	get bestLapTime() {

		return this.lapTimes.length > 0 ? Math.min( ...this.lapTimes ) : null;

	}

	startRace( laps ) {

		this.totalLaps = laps;
		this.currentLap = 1;
		this.lapTimes = [];
		this._elapsed = 0;
		this._lapStart = 0;
		this._lastSide = null;
		this._maxDist = 0;
		this.state = 'racing';

	}

	update( dt, vehiclePos ) {

		if ( this.state !== 'racing' ) return;

		this._elapsed += dt;

		const side = vehiclePos[ this._axis ] > this._finishValue ? 1 : - 1;
		const dist = Math.abs( vehiclePos[ this._axis ] - this._finishValue );
		this._maxDist = Math.max( this._maxDist, dist );

		const orth = vehiclePos[ this._orthAxis ];
		const inCell = orth >= this._orthMin && orth <= this._orthMax;

		if ( this._lastSide !== null &&
		     side !== this._lastSide &&
		     this._maxDist > MIN_TRAVEL &&
		     inCell ) {

			const lapTime = this._elapsed - this._lapStart;
			this.lapTimes.push( lapTime );
			this._lapStart = this._elapsed;
			this._maxDist = 0;

			if ( this.currentLap >= this.totalLaps ) {

				this.state = 'finished';

			} else {

				this.currentLap++;

			}

		}

		this._lastSide = side;

	}

}
