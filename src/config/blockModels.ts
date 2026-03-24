export interface LandscapeBlock {
  path: string
  side: 'left' | 'right'
}

const base = import.meta.env.BASE_URL

// Ordered sequence: city (3 pairs) → city_nature (1 pair) → nature (3 pairs) → nature_city (1 pair)
// Each pair is [left, right]. The sequence loops.
export const landscapeSequence: LandscapeBlock[] = [
  // City
  { path: `${base}assets/blocks/landscape/city_left1.glb`, side: 'left' },
  { path: `${base}assets/blocks/landscape/city_right1.glb`, side: 'right' },
  { path: `${base}assets/blocks/landscape/city_left2.glb`, side: 'left' },
  { path: `${base}assets/blocks/landscape/city_right2.glb`, side: 'right' },
  { path: `${base}assets/blocks/landscape/city_left3.glb`, side: 'left' },
  { path: `${base}assets/blocks/landscape/city_right3.glb`, side: 'right' },
  // City → Nature
  {
    path: `${base}assets/blocks/landscape/city_nature_left1.glb`,
    side: 'left',
  },
  {
    path: `${base}assets/blocks/landscape/city_nature_right1.glb`,
    side: 'right',
  },
  // Nature
  { path: `${base}assets/blocks/landscape/nature_left1.glb`, side: 'left' },
  { path: `${base}assets/blocks/landscape/nature_right1.glb`, side: 'right' },
  { path: `${base}assets/blocks/landscape/nature_left2.glb`, side: 'left' },
  { path: `${base}assets/blocks/landscape/nature_right2.glb`, side: 'right' },
  { path: `${base}assets/blocks/landscape/nature_left3.glb`, side: 'left' },
  { path: `${base}assets/blocks/landscape/nature_right3.glb`, side: 'right' },
  // Nature → City
  {
    path: `${base}assets/blocks/landscape/nature_city_left1.glb`,
    side: 'left',
  },
  {
    path: `${base}assets/blocks/landscape/nature_city_right1.glb`,
    side: 'right',
  },
]
