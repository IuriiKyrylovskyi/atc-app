import airportsData from '../../../../AIRPORTS_OBJECTS.json';

export interface IAirportRaw {
  number: number;
  airport1: string | null;
  airport2: string | null;
  icao1: string;
  icao2: string | null;
  iata1: string | null;
  iata2: string | null;
  brief: string;
  funny: string;
}

export interface IAirfield {
  icao: string;
  iata: string;
  name: string;
  subtext: string;
  funnyText: string;
  number: number;
  isPremium?: boolean;
  isTraining?: boolean;
  icon1?: string;
  icon2?: string;
}

export const airports: IAirfield[] = airportsData.map((el: IAirportRaw) => ({
  icao: el.icao2 ? `${el.icao1}/${el.icao2}` : el.icao1,
  iata: el.iata2 ? `${el.iata1}/${el.iata2}` : el.iata1 ?? '',
  name: el.airport2 ? `${el.airport1}/${el.airport2}` : el.airport1,
  subtext: el.brief,
  funnyText: el.funny,
  number: el.number,
  isPremium: el.number > 3,
  icon1: '',
  icon2: '',
}));
