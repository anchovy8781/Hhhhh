/**
 * Application profiles.
 *
 * "Does this design work?" has no answer without "where?". A converter that is
 * fine in a desktop adapter is a fire in a sealed roadside cabinet, and the
 * difference is not in the winding. Each profile sets the conditions that
 * application actually imposes and the limits it is judged against.
 */

import type { Environment } from "./environment";
import type { Metric, Warning } from "./types";

export interface ApplicationRequirements {
  /** Minimum thermal class the winding insulation must carry [°C]. */
  insulationClass: number;
  /** Absolute limit on any part's temperature [°C]. */
  maxHotspot: number;
  /** Flux must stay below this fraction of saturation. */
  saturationMargin: number;
  minEfficiency?: number;
  note: string;
}

export interface Application {
  id: string;
  name: string;
  note: string;
  tags: string[];
  environment: Partial<Environment>;
  requirements: ApplicationRequirements;
}

export const APPLICATIONS: Application[] = [
  {
    id: "bench",
    name: "실험실 · 벤치",
    note: "상온 개방 환경. 설계 감각을 잡을 때의 기준입니다.",
    tags: ["기본", "시제품"],
    environment: { ambient: 25, coolingId: "natural-air", enclosure: "none", altitude: 0 },
    requirements: { insulationClass: 130, maxHotspot: 120, saturationMargin: 0.9, note: "여유 있는 기준" },
  },
  {
    id: "consumer",
    name: "소비자 가전",
    note: "밀폐에 가까운 플라스틱 케이스, 정숙 요구로 팬 없이 갑니다.",
    tags: ["가전", "어댑터", "저소음", "저가"],
    environment: { ambient: 40, coolingId: "natural-air", enclosure: "vented", altitude: 0 },
    requirements: { insulationClass: 130, maxHotspot: 105, saturationMargin: 0.85, minEfficiency: 0.88, note: "안전규격 온도상승 한계" },
  },
  {
    id: "industrial",
    name: "산업용 범용",
    note: "제어반 내부. 팬 냉각과 넉넉한 여유를 전제합니다.",
    tags: ["산업", "제어반", "24시간"],
    environment: { ambient: 45, coolingId: "forced-air-3", enclosure: "vented" },
    requirements: { insulationClass: 155, maxHotspot: 140, saturationMargin: 0.85, minEfficiency: 0.9, note: "연속 운전 기준" },
  },
  {
    id: "automotive-cabin",
    name: "자동차 실내",
    note: "−40°C 시동부터 85°C 주차까지. 진동과 수명이 함께 요구됩니다.",
    tags: ["자동차", "차량", "실내", "진동"],
    environment: { ambient: 85, coolingId: "natural-air", enclosure: "sealed" },
    requirements: { insulationClass: 155, maxHotspot: 150, saturationMargin: 0.8, note: "AEC 온도 프로파일" },
  },
  {
    id: "automotive-engine",
    name: "자동차 엔진룸",
    note: "125°C 주위 온도. 대부분의 재료가 여기서 탈락합니다.",
    tags: ["자동차", "엔진룸", "고온", "under-hood"],
    environment: { ambient: 125, coolingId: "natural-air", enclosure: "sealed" },
    requirements: { insulationClass: 200, maxHotspot: 175, saturationMargin: 0.75, note: "고온 등급 필수" },
  },
  {
    id: "ev-powertrain",
    name: "전기차 파워트레인",
    note: "수냉 재킷을 전제로 출력 밀도를 극한까지 올립니다.",
    tags: ["전기차", "ev", "수냉", "고출력밀도", "인버터"],
    environment: { ambient: 65, coolingId: "water-jacket", enclosure: "sealed" },
    requirements: { insulationClass: 200, maxHotspot: 160, saturationMargin: 0.85, minEfficiency: 0.95, note: "냉각수 온도 기준" },
  },
  {
    id: "solar-inverter",
    name: "태양광 인버터",
    note: "옥외 함체, 하루 종일 연속 운전. 효율 0.5%가 수익입니다.",
    tags: ["태양광", "인버터", "옥외", "고효율", "연속"],
    environment: { ambient: 50, coolingId: "forced-air-3", enclosure: "vented", humidity: 85 },
    requirements: { insulationClass: 180, maxHotspot: 140, saturationMargin: 0.8, minEfficiency: 0.97, note: "20년 수명 기준" },
  },
  {
    id: "datacenter-psu",
    name: "서버 전원",
    note: "1U 높이 제약, 강한 강제 공랭, 최고 효율 등급 요구.",
    tags: ["서버", "데이터센터", "고효율", "저배", "psu"],
    environment: { ambient: 45, coolingId: "forced-air-6", enclosure: "vented" },
    requirements: { insulationClass: 180, maxHotspot: 135, saturationMargin: 0.85, minEfficiency: 0.96, note: "80PLUS 티타늄 수준" },
  },
  {
    id: "aerospace",
    name: "항공 (고고도)",
    note: "12km 상공은 공기가 1/4이라 대류 냉각을 거의 못 씁니다.",
    tags: ["항공", "고고도", "경량", "전도냉각"],
    environment: { ambient: 70, coolingId: "conduction-chassis", enclosure: "sealed", altitude: 12000 },
    requirements: { insulationClass: 200, maxHotspot: 150, saturationMargin: 0.75, minEfficiency: 0.95, note: "DO-160 환경" },
  },
  {
    id: "space",
    name: "우주 · 진공",
    note: "대류가 아예 없습니다. 복사와 전도만으로 열을 버려야 합니다.",
    tags: ["우주", "진공", "위성", "복사냉각"],
    environment: { ambient: 40, coolingId: "conduction-chassis", enclosure: "sealed", altitude: 12000, emissivity: 0.9 },
    requirements: { insulationClass: 220, maxHotspot: 125, saturationMargin: 0.7, note: "단일 고장 무허용" },
  },
  {
    id: "medical",
    name: "의료기기",
    note: "환자 접촉을 전제한 강화 절연과 낮은 표면 온도.",
    tags: ["의료", "절연", "저온도", "안전"],
    environment: { ambient: 30, coolingId: "natural-air", enclosure: "sealed" },
    requirements: { insulationClass: 155, maxHotspot: 95, saturationMargin: 0.8, note: "IEC 60601 접촉 온도" },
  },
  {
    id: "rail",
    name: "철도 차량",
    note: "먼지·진동·30년 수명. 여유가 곧 신뢰성입니다.",
    tags: ["철도", "차량", "진동", "장수명"],
    environment: { ambient: 70, coolingId: "forced-air-3", enclosure: "vented" },
    requirements: { insulationClass: 200, maxHotspot: 155, saturationMargin: 0.7, minEfficiency: 0.96, note: "EN 50155" },
  },
  {
    id: "marine",
    name: "선박 · 해상",
    note: "염분과 습기. 밀폐가 필수라 방열이 나빠집니다.",
    tags: ["선박", "해상", "부식", "습기", "밀폐"],
    environment: { ambient: 55, coolingId: "natural-air", enclosure: "sealed", humidity: 95 },
    requirements: { insulationClass: 180, maxHotspot: 130, saturationMargin: 0.8, note: "염해 환경" },
  },
  {
    id: "military",
    name: "군용",
    note: "−55°C부터 85°C까지, 충격과 진동을 함께 견딥니다.",
    tags: ["군용", "방산", "광온도", "충격"],
    environment: { ambient: 85, coolingId: "conduction-chassis", enclosure: "potted" },
    requirements: { insulationClass: 220, maxHotspot: 150, saturationMargin: 0.7, note: "MIL-STD-810" },
  },
  {
    id: "outdoor-telecom",
    name: "옥외 통신 함체",
    note: "직사광선 아래 밀폐 함체. 내부는 외기보다 20°C 높습니다.",
    tags: ["통신", "기지국", "옥외", "밀폐"],
    environment: { ambient: 60, coolingId: "sealed-enclosure", enclosure: "sealed", humidity: 90 },
    requirements: { insulationClass: 180, maxHotspot: 130, saturationMargin: 0.8, note: "무보수 10년" },
  },
  {
    id: "welding",
    name: "용접기",
    note: "간헐 대전류. 듀티가 낮은 대신 순간 부하가 극단적입니다.",
    tags: ["용접", "대전류", "간헐", "저듀티"],
    environment: { ambient: 40, coolingId: "forced-air-6", enclosure: "vented", dutyCycle: 0.35 },
    requirements: { insulationClass: 180, maxHotspot: 155, saturationMargin: 0.9, note: "정격 듀티 35%" },
  },
  {
    id: "induction-heating",
    name: "유도가열",
    note: "고주파 대전력. 코어 손실과 표피효과가 지배합니다.",
    tags: ["유도가열", "고주파", "대전력", "리츠"],
    environment: { ambient: 45, coolingId: "water-jacket", enclosure: "vented" },
    requirements: { insulationClass: 200, maxHotspot: 140, saturationMargin: 0.8, minEfficiency: 0.95, note: "연속 고주파" },
  },
  {
    id: "wireless-power",
    name: "무선 전력 전송",
    note: "공극이 큰 결합. 누설 자속과 발열이 함께 문제입니다.",
    tags: ["무선충전", "wpt", "공진", "고주파"],
    environment: { ambient: 40, coolingId: "natural-air", enclosure: "vented" },
    requirements: { insulationClass: 155, maxHotspot: 100, saturationMargin: 0.8, note: "인체 근접" },
  },
  {
    id: "led-driver",
    name: "LED 조명 드라이버",
    note: "등기구 안은 좁고 뜨겁습니다. 수명은 곧 온도입니다.",
    tags: ["조명", "led", "소형", "장수명", "저가"],
    environment: { ambient: 55, coolingId: "natural-air", enclosure: "potted" },
    requirements: { insulationClass: 155, maxHotspot: 105, saturationMargin: 0.85, minEfficiency: 0.9, note: "50000시간 수명" },
  },
  {
    id: "instrument",
    name: "계측기",
    note: "발열보다 정밀도와 안정성이 중요합니다.",
    tags: ["계측", "정밀", "저드리프트", "저노이즈"],
    environment: { ambient: 30, coolingId: "natural-air", enclosure: "vented" },
    requirements: { insulationClass: 130, maxHotspot: 70, saturationMargin: 0.5, note: "온도 드리프트 최소화" },
  },
];

const BY_ID = new Map(APPLICATIONS.map((app) => [app.id, app]));

export function application(id: string): Application {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`알 수 없는 용도: ${id}`);
  return found;
}

/** The environment values an application implies, for the UI to apply. */
export function applicationValues(id: string): Record<string, number | string> {
  const app = application(id);
  const env = app.environment;
  const out: Record<string, number | string> = { "app.profile": id };
  if (env.ambient !== undefined) out["env.ambient"] = env.ambient;
  if (env.altitude !== undefined) out["env.altitude"] = env.altitude;
  if (env.coolingId !== undefined) out["env.cooling"] = env.coolingId;
  if (env.enclosure !== undefined) out["env.enclosure"] = env.enclosure;
  if (env.emissivity !== undefined) out["env.emissivity"] = env.emissivity;
  if (env.humidity !== undefined) out["env.humidity"] = env.humidity;
  if (env.dutyCycle !== undefined) out["env.duty"] = env.dutyCycle * 100;
  return out;
}

export interface DesignSnapshot {
  /** Hottest part temperature [°C]. */
  hotspot: number;
  /** Peak flux as a fraction of saturation. */
  saturation: number;
  efficiency?: number;
  /** Thermal class of the winding insulation actually chosen [°C]. */
  insulationClass?: number;
}

/** Judge a design against the application it is meant for. */
export function checkApplication(
  app: Application,
  snapshot: DesignSnapshot,
): Warning[] {
  const warnings: Warning[] = [];
  const req = app.requirements;

  if (snapshot.hotspot > req.maxHotspot) {
    warnings.push({
      level: "error",
      text: `${app.name} 기준 최고 허용 온도 ${req.maxHotspot}°C를 넘습니다 (현재 ${snapshot.hotspot.toFixed(0)}°C). ${req.note}.`,
    });
  } else if (snapshot.hotspot > req.maxHotspot - 15) {
    warnings.push({
      level: "warn",
      text: `${app.name} 허용 온도 ${req.maxHotspot}°C까지 ${(req.maxHotspot - snapshot.hotspot).toFixed(0)}°C밖에 안 남았습니다.`,
    });
  }

  if (snapshot.saturation > req.saturationMargin) {
    warnings.push({
      level: snapshot.saturation > 1 ? "error" : "warn",
      text: `${app.name}는 자속을 포화의 ${(req.saturationMargin * 100).toFixed(0)}% 이하로 요구합니다 (현재 ${(snapshot.saturation * 100).toFixed(0)}%).`,
    });
  }

  if (
    snapshot.insulationClass !== undefined &&
    snapshot.insulationClass < req.insulationClass
  ) {
    warnings.push({
      level: "error",
      text: `${app.name}는 절연 열등급 ${req.insulationClass}°C 이상을 요구합니다. 지금 권선은 ${snapshot.insulationClass}°C 등급입니다.`,
    });
  }

  if (
    req.minEfficiency !== undefined &&
    snapshot.efficiency !== undefined &&
    snapshot.efficiency > 0 &&
    snapshot.efficiency < req.minEfficiency
  ) {
    warnings.push({
      level: "warn",
      text: `${app.name} 목표 효율 ${(req.minEfficiency * 100).toFixed(0)}%에 미달합니다 (현재 ${(snapshot.efficiency * 100).toFixed(1)}%).`,
    });
  }

  return warnings;
}

/** Read the snapshot an application check needs out of a device's metrics. */
export function snapshotFrom(
  metrics: Metric[],
  saturation: number,
  insulationClass?: number,
): DesignSnapshot {
  const raw = (key: string) => metrics.find((m) => m.key === key)?.raw;
  return {
    hotspot: raw("temp") ?? 25,
    saturation,
    efficiency: raw("eff"),
    insulationClass,
  };
}
