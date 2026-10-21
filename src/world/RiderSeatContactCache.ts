interface RiderVisual { readonly children: readonly object[] }

/** A rider container survives equipment-tier rebuilds; its visual instances do not.
 * Cache contacts only while those instances still own the sampled surfaces.
 * LOD visibility/animation changes retain the same instances and contact points. */
export class RiderSeatContactCache<Rider extends RiderVisual, Contact> {
  private readonly contacts = new WeakMap<Rider, { visuals: readonly object[]; contact: Contact }>()

  constructor(private readonly create: (rider: Rider) => Contact) {}

  get(rider: Rider): Contact {
    const cached = this.contacts.get(rider)
    if (cached && cached.visuals.length === rider.children.length
      && cached.visuals.every((visual, index) => visual === rider.children[index])) return cached.contact

    const contact = this.create(rider)
    this.contacts.set(rider, { visuals: [...rider.children], contact })
    return contact
  }
}
