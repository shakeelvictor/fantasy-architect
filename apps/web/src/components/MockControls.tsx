// v1's #mock-controls card: Start Mock / Pause / Reset and the bot speed
// slider (v1's mapping kept: speed = 3200 − slider, so right = faster).

import type { DraftEvent, SeasonConfig } from '@fa/rules';
import type { PoolPlayer } from '../api';
import { resetMock, setSpeed, startBots, stopBots, useMock } from '../mock';

interface Props {
  players: PoolPlayer[];
  byPid: Map<string, PoolPlayer>;
  config: SeasonConfig;
  events: DraftEvent[];
  mySlot: number;
}

export function MockControls({ players, byPid, config, events, mySlot }: Props): React.JSX.Element {
  const mock = useMock();
  return (
    <div className="card" id="mock-controls">
      <h3>Mock Controls</h3>
      <div className="mock-row">
        <button className="btn primary" id="mock-start" data-testid="mock-start"
          disabled={mock.running}
          onClick={() => startBots(players, byPid, config, events, mySlot)}>
          Start Mock
        </button>
        <button className="btn" id="mock-pause" data-testid="mock-pause" disabled={!mock.running} onClick={stopBots}>
          Pause
        </button>
        <button className="btn danger" id="mock-reset" data-testid="mock-reset"
          onClick={() => {
            if (window.confirm('Clear all mock picks and restart?')) resetMock();
          }}>
          Reset
        </button>
      </div>
      <label className="range-row">Bot speed
        <input type="range" id="mock-speed" data-testid="mock-speed" min={200} max={3000} step={100}
          value={3200 - mock.speed}
          onChange={(e) => setSpeed(3200 - parseInt(e.target.value, 10))} />
      </label>
      <p className="p-meta" style={{ marginTop: 8 }}>
        Bots pick for every other team and pause when you're on the clock. The real draft is untouched.
      </p>
    </div>
  );
}
