/**
 * True for LRT station names: "... Station", Valley Line "... Stop", and "... Station Underground".
 * Matches the station rank in searchIndex's SQL; "Clareview Station Drive & 143 Avenue" is a street.
 */
export const isStationName = (name: string): boolean => /(station|stop)( underground)?$/i.test(name.trim())
