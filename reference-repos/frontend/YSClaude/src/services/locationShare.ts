import * as Location from 'expo-location';
import { randomUUID } from 'expo-crypto';
import type { LocationAttachment } from '../types';
import type { LocationShareConfig } from '../stores/settings';

const TENCENT_REVERSE_GEOCODER_URL = 'https://apis.map.qq.com/ws/geocoder/v1/';
const TENCENT_STATIC_MAP_URL = 'https://apis.map.qq.com/ws/staticmap/v2/';

type TencentReverseGeocoderResponse = {
  status?: number;
  message?: string;
  result?: {
    address?: string;
    formatted_addresses?: {
      recommend?: string;
      rough?: string;
    };
    address_component?: {
      province?: string;
      city?: string;
      district?: string;
    };
    location?: {
      lat?: number;
      lng?: number;
    };
    pois?: Array<{
      title?: string;
      address?: string;
      location?: {
        lat?: number;
        lng?: number;
      };
    }>;
  };
};

type TencentPlaceSearchResponse = {
  status?: number;
  message?: string;
  data?: Array<{
    id?: string;
    title?: string;
    address?: string;
    province?: string;
    city?: string;
    district?: string;
    location?: {
      lat?: number;
      lng?: number;
    };
  }>;
};

export type LocationDraft = Omit<LocationAttachment, 'id' | 'createdAt'>;

export type LocationSearchResult = {
  id: string;
  title: string;
  address: string;
  latitude: number;
  longitude: number;
  province?: string;
  city?: string;
  district?: string;
};

function requireTencentKey(config: LocationShareConfig): string {
  const key = (config.tencentKey || '').trim();
  if (!config.enabled) {
    throw new Error('请先在设置 - 工具设置 - 其他功能中启用位置分享');
  }
  if (!key) {
    throw new Error('请先在设置 - 工具设置 - 其他功能中填写腾讯地图 Key');
  }
  return key;
}

function buildTencentStaticMapUrl(key: string, latitude: number, longitude: number): string {
  const marker = `size:large|color:red|${latitude},${longitude}`;
  const params = new URLSearchParams({
    key,
    center: `${latitude},${longitude}`,
    zoom: '16',
    size: '600*260',
    scale: '2',
    maptype: 'roadmap',
    format: 'png',
    markers: marker,
  });
  return `${TENCENT_STATIC_MAP_URL}?${params.toString()}`;
}

function buildTencentMapUrl(latitude: number, longitude: number, title: string): string {
  const params = new URLSearchParams({
    type: 'marker',
    coord: `${latitude},${longitude}`,
    title: title || '我的位置',
    referer: 'YSClaude',
  });
  return `https://apis.map.qq.com/uri/v1/marker?${params.toString()}`;
}

async function reverseGeocodeTencent(
  key: string,
  latitude: number,
  longitude: number,
  coordType: '1' | '5'
): Promise<TencentReverseGeocoderResponse['result']> {
  const params = new URLSearchParams({
    key,
    location: `${latitude},${longitude}`,
    get_poi: '1',
    coord_type: coordType,
    poi_options: 'address_format=short;radius=1000;page_size=10;page_index=1;policy=5',
  });
  const response = await fetch(`${TENCENT_REVERSE_GEOCODER_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`腾讯位置解析请求失败：HTTP ${response.status}`);
  }
  const data = (await response.json()) as TencentReverseGeocoderResponse;
  if (data.status !== 0 || !data.result) {
    throw new Error(data.message || `腾讯位置解析失败：${data.status ?? '未知错误'}`);
  }
  return data.result;
}

async function searchTencentPlaces(
  key: string,
  keyword: string,
  center?: { latitude: number; longitude: number; city?: string }
): Promise<TencentPlaceSearchResponse['data']> {
  const params = new URLSearchParams({
    key,
    keyword,
    page_size: '12',
    page_index: '1',
  });
  if (center) {
    params.set('boundary', `nearby(${center.latitude},${center.longitude},50000,1)`);
  } else {
    params.set('boundary', 'region(全国,0)');
  }
  const response = await fetch(`https://apis.map.qq.com/ws/place/v1/search?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`腾讯地点搜索请求失败：HTTP ${response.status}`);
  }
  const data = (await response.json()) as TencentPlaceSearchResponse;
  if (data.status !== 0) {
    throw new Error(data.message || `腾讯地点搜索失败：${data.status ?? '未知错误'}`);
  }
  return data.data || [];
}

function pickLocationTitle(result: TencentReverseGeocoderResponse['result']): string {
  const poiTitle = result?.pois?.find((poi) => poi.title?.trim())?.title?.trim();
  if (poiTitle) return poiTitle;
  const recommended = result?.formatted_addresses?.recommend?.trim();
  if (recommended) return recommended;
  const rough = result?.formatted_addresses?.rough?.trim();
  if (rough) return rough;
  return result?.address?.trim() || '我的位置';
}

export function formatLocationForAi(location: LocationAttachment): string {
  return [
    '用户当前位置：',
    `地点：${location.title || '我的位置'}`,
    location.address ? `地址：${location.address}` : null,
    `经纬度：${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`,
  ].filter(Boolean).join('\n');
}

export function finalizeLocationDraft(draft: LocationDraft): LocationAttachment {
  return {
    ...draft,
    id: `loc_${randomUUID()}`,
    createdAt: Date.now(),
  };
}

export async function resolveTencentLocationDraft(
  config: LocationShareConfig,
  latitude: number,
  longitude: number,
  coordType: '1' | '5' = '5'
): Promise<LocationDraft> {
  const key = requireTencentKey(config);
  const result = await reverseGeocodeTencent(key, latitude, longitude, coordType);
  const mapLatitude = result?.location?.lat ?? latitude;
  const mapLongitude = result?.location?.lng ?? longitude;
  const title = pickLocationTitle(result);
  const address = result?.address?.trim() || title;

  return {
    provider: 'tencent',
    latitude,
    longitude,
    mapLatitude,
    mapLongitude,
    title,
    address,
    province: result?.address_component?.province,
    city: result?.address_component?.city,
    district: result?.address_component?.district,
    thumbnailUrl: buildTencentStaticMapUrl(key, mapLatitude, mapLongitude),
    mapUrl: buildTencentMapUrl(mapLatitude, mapLongitude, title),
  };
}

export async function searchLocationDrafts(
  config: LocationShareConfig,
  keyword: string,
  center?: LocationDraft | null
): Promise<LocationSearchResult[]> {
  const key = requireTencentKey(config);
  const query = keyword.trim();
  if (!query) return [];
  const data = await searchTencentPlaces(
    key,
    query,
    center ? { latitude: center.mapLatitude ?? center.latitude, longitude: center.mapLongitude ?? center.longitude, city: center.city } : undefined
  );
  return (data || [])
    .filter((item) => item.location && typeof item.location.lat === 'number' && typeof item.location.lng === 'number')
    .map((item, index) => ({
      id: item.id || `${item.title || query}-${index}`,
      title: item.title || query,
      address: item.address || '',
      latitude: item.location!.lat!,
      longitude: item.location!.lng!,
      province: item.province,
      city: item.city,
      district: item.district,
    }));
}

export async function createLocationDraftFromSearchResult(
  config: LocationShareConfig,
  result: LocationSearchResult
): Promise<LocationDraft> {
  const draft = await resolveTencentLocationDraft(config, result.latitude, result.longitude);
  return {
    ...draft,
    title: result.title || draft.title,
    address: result.address || draft.address,
    province: result.province || draft.province,
    city: result.city || draft.city,
    district: result.district || draft.district,
  };
}

export async function createCurrentLocationDraft(
  config: LocationShareConfig
): Promise<LocationDraft> {
  requireTencentKey(config);
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    throw new Error('无法获取当前位置，请先允许定位权限');
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  const latitude = position.coords.latitude;
  const longitude = position.coords.longitude;
  return resolveTencentLocationDraft(config, latitude, longitude, '1');
}

export async function createCurrentLocationAttachment(
  config: LocationShareConfig
): Promise<LocationAttachment> {
  return finalizeLocationDraft(await createCurrentLocationDraft(config));
}
