// Back and forward: the places where the user was in a window, as in a browser. A place is a
// tab and a position in its document (src/editor/plugins/places.ts). Only jumps add a place: a
// tab change, an opened file or an outline jump. Typing and normal cursor movement do not.

export interface Place {
  tab: number
}

// The history keeps no more places than this, so that it does not grow in a long session.
export const LIMIT = 100

export class History<P extends Place> {
  private places: P[] = []
  private index = -1

  // `drop` gets each place that the history does not keep, so that its position can stop
  // following the edits.
  constructor(private drop: (place: P) => void = () => {}) {}

  // A jump from one place to another. `from` is null when no tab was open before. The places
  // after the current place (after a back) go away.
  visit(from: P | null, to: P) {
    this.places.splice(this.index + 1).forEach(this.drop)
    if (from) {
      // The current place gets the position where the user was just before the jump.
      if (this.places[this.index]?.tab === from.tab) this.replaceCurrent(from)
      else this.places.push(from)
    }
    this.places.push(to)
    if (this.places.length > LIMIT) this.places.splice(0, this.places.length - LIMIT).forEach(this.drop)
    this.index = this.places.length - 1
  }

  // `here` is the place now. `isOpen` tells if a tab is still open: places of closed tabs are
  // skipped. Returns null when there is no place to go to.
  back(here: P | null, isOpen: (tab: number) => boolean): P | null {
    return this.go(-1, here, isOpen)
  }

  forward(here: P | null, isOpen: (tab: number) => boolean): P | null {
    return this.go(1, here, isOpen)
  }

  // A tab is closed: its places go away.
  forget(tab: number) {
    // When the current place goes away, the place before it is the current place.
    const index = this.index
    this.places = this.places.filter((place, i) => {
      if (place.tab !== tab) return true
      if (i <= index) this.index--
      this.drop(place)
      return false
    })
  }

  // The number of places, for the tests.
  get size() {
    return this.places.length
  }

  private go(step: number, here: P | null, isOpen: (tab: number) => boolean): P | null {
    let i = this.index + step
    while (this.places[i] && !isOpen(this.places[i].tab)) i += step
    const place = this.places[i]
    // Keep the position where the user is now, so that the opposite step comes back to it.
    if (place && here && this.places[this.index]?.tab === here.tab) this.replaceCurrent(here)
    else if (here && here !== this.places[this.index]) this.drop(here)
    if (!place) return null
    this.index = i
    return place
  }

  private replaceCurrent(place: P) {
    if (this.places[this.index] === place) return
    this.drop(this.places[this.index])
    this.places[this.index] = place
  }
}
