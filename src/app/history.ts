// Back and forward: the places where the user was in a window, as in a browser. A place is a
// tab and a position in its document. Only jumps add a place: a tab change, an opened file or
// an outline jump. Typing and normal cursor movement do not.

export interface Place {
  tab: number
  // The cursor position in the editor document.
  pos: number
  scroll: number
}

export class History {
  private places: Place[] = []
  private index = -1

  // A jump from one place to another. `from` is null when no tab was open before. The places
  // after the current place (after a back) go away.
  visit(from: Place | null, to: Place) {
    this.places.length = this.index + 1
    if (from) {
      // The current place gets the position where the user was just before the jump.
      if (this.places[this.index]?.tab === from.tab) this.places[this.index] = from
      else this.places.push(from)
    }
    this.places.push(to)
    this.index = this.places.length - 1
  }

  // `here` is the place now. `isOpen` tells if a tab is still open: places of closed tabs are
  // skipped. Returns null when there is no place to go to.
  back(here: Place | null, isOpen: (tab: number) => boolean): Place | null {
    return this.go(-1, here, isOpen)
  }

  forward(here: Place | null, isOpen: (tab: number) => boolean): Place | null {
    return this.go(1, here, isOpen)
  }

  private go(step: number, here: Place | null, isOpen: (tab: number) => boolean): Place | null {
    let i = this.index + step
    while (this.places[i] && !isOpen(this.places[i].tab)) i += step
    const place = this.places[i]
    if (!place) return null
    // Keep the position where the user is now, so that the opposite step comes back to it.
    if (here && this.places[this.index]?.tab === here.tab) this.places[this.index] = here
    this.index = i
    return place
  }
}
