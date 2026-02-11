export type AtBusCancel = {
  v: number;
  type: "atbus:cancel";
  id: string;
  sourceId?: string;
  targetId?: string;
  bus?: string;
};
