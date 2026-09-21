/**
 * The one backbone this demo follows, and the name it is shown under.
 *
 * The footprint and the routing events are a real carrier's: its facility list
 * is public in PeeringDB, and its routes are public in RIPE RIS. The operator
 * name on the page is not. Every operational figure the dashboard draws beyond
 * the routing events is derived or simulated, and the page says which is which,
 * so putting the real company's name beside them would be asserting things
 * about that company that are not true. The carrier is therefore left unnamed
 * and the dashboard is branded as an invented one.
 */
export const CARRIER = {
  /** The autonomous system whose routes RIS Live is asked for. */
  asn: 3257,
  /** Its PeeringDB network id, which the facility list hangs off. */
  netId: 14,
  /** The invented operator this dashboard belongs to. */
  brand: 'Northwind Telecom',
  short: 'Northwind',
};
