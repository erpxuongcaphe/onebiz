// Pipeline Engine types

export interface Pipeline {
  id: string;
  tenantId: string;
  entityType: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
}

export interface PipelineStage {
  id: string;
  pipelineId: string;
  code: string;
  name: string;
  color?: string;
  icon?: string;
  sortOrder: number;
  isInitial: boolean;
  isFinal: boolean;
  validationRules?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface PipelineTransition {
  id: string;
  pipelineId: string;
  fromStageId: string;
  toStageId: string;
  name?: string;
  requiredRole?: string;
  conditions?: Record<string, unknown>;
  autoTrigger: boolean;
}

export interface PipelineItem {
  id: string;
  tenantId: string;
  pipelineId: string;
  entityId: string;
  currentStageId: string;
  dimensions: Record<string, string>;
  enteredAt: string;
  updatedAt: string;
}

export interface PipelineHistory {
  id: string;
  pipelineItemId: string;
  fromStageId?: string;
  toStageId: string;
  transitionId?: string;
  changedBy?: string;
  changedAt: string;
  note?: string;
  metadata?: Record<string, unknown>;
}

// UI types
export interface PipelineBoardColumn {
  stageId: string;
  code: string;
  name: string;
  color?: string;
  isInitial: boolean;
  isFinal: boolean;
  items: PipelineBoardItem[];
  count: number;
}

export interface PipelineBoardItem {
  id: string;
  entityId: string;
  dimensions: Record<string, string>;
  enteredAt: string;
}

export interface PipelineBoard {
  pipelineId: string;
  columns: PipelineBoardColumn[];
}

export interface AllowedTransition {
  transitionId: string;
  name?: string;
  toStageId: string;
  toStageCode: string;
  toStageName: string;
  toStageColor?: string;
}

export interface TimelineEntry {
  id: string;
  changedAt: string;
  note?: string;
  fromStage?: string;
  fromStageCode?: string;
  fromColor?: string;
  toStage: string;
  toStageCode: string;
  toColor?: string;
  changedBy?: string;
}

export interface PipelineAutomation {
  id: string;
  tenantId: string;
  name: string;
  triggerPipelineId: string;
  triggerStageId: string;
  actionType: 'create_pipeline_item' | 'transition' | 'notify' | 'webhook';
  actionConfig: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
}
