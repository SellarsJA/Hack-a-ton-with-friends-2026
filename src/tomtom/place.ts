export type Place = {
  kind: 'current' | 'stop' | 'address'
  label: string
  lat: number
  lon: number
}
