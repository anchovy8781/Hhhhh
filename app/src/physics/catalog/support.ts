/** Insulation, structural and cooling options. */

import type {
  CoolantOption,
  InsulationMaterial,
  StructuralMaterial,
} from "../material-types";

const FILM_THICKNESS = [0.025, 0.05, 0.075, 0.1, 0.125, 0.19, 0.25, 0.35];

type FilmRow = [id: string, name: string, cls: number, kv: number, k: number, cost: number, tags: string, note: string];

const FILMS: FilmRow[] = [
  ["nomex410", "노멕스 410", 220, 27, 0.14, 6, "슬롯 상간 아라미드", "아라미드 종이. 모터 슬롯·상간 절연의 표준입니다."],
  ["nmn", "NMN 복합지", 180, 40, 0.16, 5, "슬롯 복합 모터", "노멕스-마일라-노멕스 복합. 강도와 절연을 겸합니다."],
  ["mylar", "마일라 (PET)", 130, 150, 0.15, 1.5, "층간 저가 필름", "값싸고 절연 강도가 높지만 열에 약합니다."],
  ["kapton", "캡톤 (PI)", 240, 240, 0.12, 25, "고온 항공 우주", "가장 높은 온도와 절연 강도. 매우 비쌉니다."],
  ["ptfe", "테프론 (PTFE)", 260, 60, 0.25, 12, "고온 내약품", "화학적으로 완전히 안정하고 마찰이 없습니다."],
  ["polysulfone", "폴리설폰", 180, 130, 0.18, 4, "보빈 투명", "치수 안정성이 좋아 보빈에도 씁니다."],
  ["pressboard", "프레스보드", 105, 10, 0.2, 0.6, "유입변압기 절연지", "유입 변압기의 전통적인 셀룰로오스 절연재입니다."],
  ["fishpaper", "피시페이퍼", 105, 12, 0.15, 0.4, "저가 층간", "값싼 셀룰로오스 절연지입니다."],
];

const IMPREGNANTS: InsulationMaterial[] = ([
  ["varnish-polyester", "폴리에스터 바니시", 155, 20, 0.2, 1.2, "함침 진동 소음"],
  ["varnish-epoxy", "에폭시 바니시", 180, 22, 0.25, 2.0, "함침 고온"],
  ["epoxy-potting", "에폭시 포팅", 155, 20, 0.6, 2.5, "포팅 방열 진동"],
  ["epoxy-alumina", "알루미나 충전 에폭시", 180, 18, 1.4, 4.0, "포팅 고방열"],
  ["silicone-potting", "실리콘 포팅", 200, 20, 0.35, 3.5, "포팅 유연 저응력"],
  ["polyurethane-potting", "폴리우레탄 포팅", 130, 18, 0.3, 1.8, "포팅 저가 방수"],
  ["vpi-resin", "VPI 수지", 200, 24, 0.3, 5.0, "진공함침 대형기"],
] as [string, string, number, number, number, number, string][]).map(
  ([id, name, cls, kv, k, cost, tags]): InsulationMaterial => ({
    id,
    name,
    family: "함침 · 포팅",
    thermalClass: cls,
    dielectricStrength: kv,
    thickness: 0,
    thermalConductivity: k,
    cost,
    tags: ["절연", "함침", ...tags.split(" ")],
    provenance: "수지 계열 공개 물성",
    note: `열등급 ${cls}°C, 열전도 ${k} W/mK. 권선을 굳혀 진동과 소음을 줄이고 열을 빼냅니다.`,
  }),
);

export const INSULATION_MATERIALS: InsulationMaterial[] = [
  ...FILMS.flatMap(([id, name, cls, kv, k, cost, tags, note]) =>
    FILM_THICKNESS.map(
      (thickness): InsulationMaterial => ({
        id: `${id}-${String(thickness).replace(".", "")}`,
        name: `${name} ${thickness}mm`,
        family: "절연 필름 · 종이",
        thermalClass: cls,
        dielectricStrength: kv,
        thickness: thickness * 1e-3,
        thermalConductivity: k,
        cost: cost * (0.6 + thickness * 2),
        tags: ["절연", "필름", `${thickness}mm`, ...tags.split(" ")],
        provenance: "필름 등급 물성 × 표준 두께",
        note: `${note} ${thickness}mm에서 내전압 약 ${Math.round(kv * thickness)}kV.`,
      }),
    ),
  ),
  ...IMPREGNANTS,
];

const PLASTIC_BASES: [id: string, name: string, temp: number, k: number, modulus: number, cost: number, tags: string][] = [
  ["pa66", "나일론 PA66", 105, 0.25, 3.0, 1.0, "보빈 저가 범용"],
  ["pbt", "PBT", 130, 0.24, 2.6, 1.2, "보빈 치수안정"],
  ["pet", "PET", 140, 0.24, 3.1, 1.1, "보빈 강성"],
  ["pps", "PPS", 200, 0.3, 3.8, 3.0, "보빈 고온 무연납"],
  ["lcp", "LCP", 240, 0.4, 11, 6.0, "초박형 고온 정밀"],
  ["peek", "PEEK", 250, 0.25, 3.6, 20, "항공 고온 고강도"],
  ["phenolic", "페놀 수지", 150, 0.3, 6.0, 0.8, "저가 내열 성형"],
  ["dmc-bmc", "BMC 열경화성", 180, 0.6, 12, 1.5, "대형 성형 절연"],
];

const GLASS_FILL = [0, 15, 30, 50];

export const STRUCTURAL_MATERIALS: StructuralMaterial[] = [
  ...PLASTIC_BASES.flatMap(([id, name, temp, k, modulus, cost, tags]) =>
    GLASS_FILL.map(
      (fill): StructuralMaterial => ({
        id: `${id}${fill ? `-gf${fill}` : ""}`,
        name: `${name}${fill ? ` GF${fill}%` : ""}`,
        family: "엔지니어링 플라스틱",
        // Glass fibre raises stiffness, heat deflection and conductivity.
        maxTemp: temp + fill * 0.5,
        density: 1350 + fill * 12,
        thermalConductivity: k * (1 + fill * 0.02),
        modulus: modulus * (1 + fill * 0.06),
        cost: cost * (1 + fill * 0.008),
        tags: ["구조재", "보빈", "플라스틱", fill ? `gf${fill}` : "무충전", ...tags.split(" ")],
        provenance: `${name} 기본 물성 + 유리섬유 ${fill}% 보강 환산`,
        note: fill
          ? `유리섬유 ${fill}% 보강으로 강성과 내열이 오르지만 성형 수축이 방향성을 갖습니다.`
          : "무충전 등급. 인성이 좋고 성형이 쉽습니다.",
      }),
    ),
  ),
  ...([
    ["alu-6061", "알루미늄 6061 하우징", 200, 167, 69, 1.2, "하우징 방열 경량"],
    ["alu-adc12", "알루미늄 다이캐스팅 ADC12", 200, 96, 71, 0.9, "하우징 대량생산"],
    ["steel-frame", "냉연강판 프레임", 400, 50, 200, 0.5, "프레임 저가 강성"],
    ["stainless-304", "스테인리스 304", 600, 16, 193, 2.5, "내식 해상 식품"],
    ["copper-heatsink", "구리 히트싱크", 400, 400, 117, 3.0, "고방열 국부냉각"],
    ["ceramic-al2o3", "알루미나 세라믹", 1200, 30, 370, 5.0, "고온 절연 방열"],
    ["ceramic-aln", "질화알루미늄 세라믹", 1000, 170, 330, 18, "고방열 절연 전력반도체"],
    ["gfrp", "유리섬유 강화 복합재", 150, 0.3, 25, 2.0, "비자성 구조"],
  ] as [string, string, number, number, number, number, string][]).map(
    ([id, name, temp, k, modulus, cost, tags]): StructuralMaterial => ({
      id,
      name,
      family: "금속 · 세라믹 구조재",
      maxTemp: temp,
      density: id.startsWith("alu") ? 2700 : id.includes("ceramic") ? 3300 : 7800,
      thermalConductivity: k,
      modulus,
      cost,
      tags: ["구조재", "하우징", ...tags.split(" ")],
      provenance: "금속·세라믹 공개 물성",
      note: `열전도 ${k} W/mK. 하우징이 방열 경로의 일부가 됩니다.`,
    }),
  ),
];

export const COOLANT_OPTIONS: CoolantOption[] = ([
  ["natural-air", "자연 공랭", 12, 200, 0, "기본 무동력 정숙"],
  ["forced-air-1", "강제 공랭 1 m/s", 25, 200, 0.5, "소형팬 저소음"],
  ["forced-air-3", "강제 공랭 3 m/s", 48, 200, 0.8, "표준팬"],
  ["forced-air-6", "강제 공랭 6 m/s", 78, 200, 1.2, "고풍량팬 소음"],
  ["forced-air-12", "강제 공랭 12 m/s", 130, 200, 2.0, "블로워 고소음"],
  ["oil-natural", "유입 자냉 (ONAN)", 60, 105, 3.0, "변압기 절연유"],
  ["oil-forced", "유입 송유 (OFAF)", 180, 105, 5.0, "대형변압기 펌프"],
  ["ester-fluid", "천연 에스터유", 55, 130, 4.0, "친환경 난연 변압기"],
  ["silicone-fluid", "실리콘유", 50, 150, 6.0, "난연 고온"],
  ["water-jacket", "수냉 재킷", 900, 90, 8.0, "고출력밀도 EV"],
  ["glycol-loop", "글리콜 냉각 루프", 700, 100, 8.5, "차량 저온동파"],
  ["cold-plate", "콜드플레이트", 1200, 90, 10, "전력반도체 최고방열"],
  ["heatpipe", "히트파이프", 300, 150, 4.0, "무동력 고효율"],
  ["conduction-chassis", "샤시 전도 냉각", 40, 200, 1.0, "밀폐 항공"],
  ["immersion-2phase", "2상 침지 냉각", 1500, 100, 15, "데이터센터 극한"],
  ["sealed-enclosure", "밀폐 함체 (냉각 없음)", 5, 200, 0.3, "방수 옥외 열악"],
] as [string, string, number, number, number, string][]).map(
  ([id, name, h, maxTemp, cost, tags]): CoolantOption => ({
    id,
    name,
    family: "냉각 방식",
    medium: /water|glycol|cold-plate|oil|ester|silicone|immersion/.test(id)
      ? "liquid"
      : /conduction|heatpipe|sealed/.test(id)
        ? "conduction"
        : "air",
    h,
    maxTemp,
    cost,
    tags: ["냉각", "방열", ...tags.split(" ")],
    provenance: "전열 계수 실무 범위값 (표면 기준)",
    note: `표면 열전달계수 약 ${h} W/m²K. 사용 상한 ${maxTemp}°C.`,
  }),
);
