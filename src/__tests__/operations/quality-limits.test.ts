import {describe,it,expect} from 'vitest';
import {draftQualityRule,type QualityRule} from '@/lib/operations/quality-contracts';
import {previewQualityScore,qualityRuleIssues} from '@/lib/operations/quality-policy';
const family='12345678-1234-4123-8123-123456789abc';
const policy:QualityRule={...draftQualityRule,floorScore:null,capScore:null,bonusCap:null,limits:{floor:false,ceiling:false,bonus:false},repeatMode:'once_per_issue',openIssueAcrossPeriods:'each_period',thresholdBasis:'after_bonus',allowAbove100:true,qcFundCents:200000000,allocations:[{userId:'manager',shareBps:10000}]};
describe('Optional scoring bounds and per-item awards',()=>{
  it('does not impose a hidden floor, ceiling or bonus cap',()=>{
    expect(qualityRuleIssues(policy)).toEqual([]);
    expect(previewQualityScore(policy,[{delta:-135,critical:false}],1).score).toBe(-35);
    expect(previewQualityScore(policy,[{delta:150,critical:false}],1).score).toBe(250);
  });
  it('still obeys an explicit no-over-100 rule without a ceiling',()=>{
    expect(previewQualityScore({...policy,allowAbove100:false},[{delta:25,critical:false}],1).score).toBe(100);
  });
  it('caps award count per item, not the entire bonus ledger',()=>{
    const rule={...policy,bonusLimits:[{familyId:family,maxAwards:1,maxPoints:null}]};
    expect(previewQualityScore(rule,[{delta:5,critical:false,familyId:family},{delta:5,critical:false,familyId:family},{delta:7,critical:false,familyId:'another'}],1)).toMatchObject({rawScore:117,score:112,bonus:17});
  });
  it('caps points per item and the total separately',()=>{
    const rule={...policy,limits:{...policy.limits!,bonus:true},bonusCap:6,bonusLimits:[{familyId:family,maxAwards:null,maxPoints:7}]};
    expect(previewQualityScore(rule,[{delta:5,critical:false,familyId:family},{delta:5,critical:false,familyId:family}],1)).toMatchObject({rawScore:110,score:106});
  });
  it('evaluates the reward threshold before or after bonus exactly as configured',()=>{
    const events=[{delta:-35,critical:false},{delta:10,critical:false}];
    expect(previewQualityScore({...policy,thresholdBasis:'before_bonus'},events,1).rewardCents).toBe(0);
    expect(previewQualityScore({...policy,thresholdBasis:'after_bonus'},events,1).rewardCents).toBe(150000000);
  });
  it('critical failure never receives a reward even with unrestricted bonuses',()=>{
    expect(previewQualityScore(policy,[{delta:100,critical:true}],1)).toMatchObject({score:200,rewardCents:0});
  });
  it('rejects a contradictory floor above 100 when over-100 is prohibited',()=>{
    expect(qualityRuleIssues({...policy,limits:{floor:true,ceiling:false,bonus:false},floorScore:110,allowAbove100:false})).not.toEqual([]);
  });
});
