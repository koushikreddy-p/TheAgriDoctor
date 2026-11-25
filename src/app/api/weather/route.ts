import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { serverError } from '@/lib/api-error'

// GET /api/weather?lat=..&lng=..  OR  ?q=<city>
// Uses OpenWeatherMap "One Call"-compatible endpoints (free tier).
export async function GET(req: NextRequest) {
  const { user } = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKey = process.env.OPENWEATHER_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'not_configured', message: 'OPENWEATHER_API_KEY is not set in environment.' },
      { status: 503 }
    )
  }

  const { searchParams } = new URL(req.url)
  const lat = searchParams.get('lat')
  const lng = searchParams.get('lng')
  const q = searchParams.get('q')

  try {
    let currentUrl: string
    let forecastUrl: string

    const validCoord = (v: string, max: number) => /^-?\d{1,3}(\.\d{1,8})?$/.test(v) && Math.abs(Number(v)) <= max
    if (lat && lng) {
      if (!validCoord(lat, 90) || !validCoord(lng, 180)) return NextResponse.json({ error: 'Invalid coordinates' }, { status: 400 })
      currentUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&units=metric&appid=${apiKey}`
      forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&units=metric&appid=${apiKey}`
    } else if (q) {
      const query = encodeURIComponent(q.slice(0, 100))
      currentUrl = `https://api.openweathermap.org/data/2.5/weather?q=${query}&units=metric&appid=${apiKey}`
      forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?q=${query}&units=metric&appid=${apiKey}`
    } else {
      return NextResponse.json({ error: 'Provide ?lat&lng or ?q=city' }, { status: 400 })
    }

    const [curRes, fcstRes] = await Promise.all([
      fetch(currentUrl, { next: { revalidate: 600 } }),
      fetch(forecastUrl, { next: { revalidate: 600 } }),
    ])

    if (!curRes.ok) {
      const errText = await curRes.text()
      return serverError('/api/weather', `upstream ${curRes.status}: ${errText.slice(0, 200)}`, 'Weather service is unavailable right now.', 502)
    }
    const current = await curRes.json()
    const forecast = fcstRes.ok ? await fcstRes.json() : null

    // Reduce forecast to one item per day (midday)
    type FcstItem = { dt: number; dt_txt: string; main: { temp: number; humidity: number }; weather: { main: string; description: string; icon: string }[]; pop?: number }
    const daily = (forecast?.list ?? [] as FcstItem[])
      .filter((f: FcstItem) => f.dt_txt?.includes('12:00:00'))
      .slice(0, 5)
      .map((f: FcstItem) => ({
        dt: f.dt,
        date: f.dt_txt,
        temp: f.main.temp,
        humidity: f.main.humidity,
        weather: f.weather[0],
        pop: f.pop ?? 0,
      }))

    return NextResponse.json({
      location: current.name ? `${current.name}${current.sys?.country ? ', ' + current.sys.country : ''}` : 'Current Location',
      coord: current.coord,
      current: {
        temp: current.main?.temp,
        feels_like: current.main?.feels_like,
        humidity: current.main?.humidity,
        pressure: current.main?.pressure,
        wind_speed: current.wind?.speed,
        wind_deg: current.wind?.deg,
        clouds: current.clouds?.all,
        rain_1h: current.rain?.['1h'] ?? 0,
        weather: current.weather?.[0],
        sunrise: current.sys?.sunrise,
        sunset: current.sys?.sunset,
      },
      forecast: daily,
    })
  } catch (err: unknown) {
    return serverError('/api/weather', err)
  }
}
