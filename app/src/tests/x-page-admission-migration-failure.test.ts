import {DatabaseSync} from "node:sqlite";
import {test,expect} from "vitest";
import {rssSourceEpochFixture} from "./helpers/rss-source-epoch.ts";
import {applyXPageAdmissionMigration,assertXPageAdmissionSchema} from "../server/x-page/admission-migration.ts";
import {sourceRegistrySchemaFingerprint} from "../server/rss/source-registry-migration.ts";

test.each([[1,0],[0,1]])("restores original pragmas FK=%i legacy=%i after repeated real writer contention and permits clean retry",async(foreignKeys,legacy)=>{
  const e=await rssSourceEpochFixture();e.gateway.close();
  e.fixtureMutation(db=>db.exec("UPDATE internal_control SET phase='paused',global_stop_state='stopped'"));
  e.database.exec(`PRAGMA foreign_keys=${foreignKeys}; PRAGMA legacy_alter_table=${legacy}; PRAGMA busy_timeout=1`);
  const writer=new DatabaseSync(e.path);
  const state=()=>({foreignKeys:e.database.prepare("PRAGMA foreign_keys").get()!.foreign_keys,
    legacy:e.database.prepare("PRAGMA legacy_alter_table").get()!.legacy_alter_table,transaction:e.database.isTransaction});
  try {
    const before=sourceRegistrySchemaFingerprint(e.database),input={applyEnabled:true,appliedAt:e.now().toISOString()};
    writer.exec("BEGIN IMMEDIATE");
    for(let attempt=0;attempt<2;attempt++){
      let error:unknown;try{applyXPageAdmissionMigration(e.database,input);}catch(caught){error=caught;}
      expect(error).toMatchObject({code:"ERR_SQLITE_ERROR",errcode:5});
      expect(state()).toEqual({foreignKeys,legacy,transaction:false});
      expect(sourceRegistrySchemaFingerprint(e.database)).toBe(before);
      expect(e.database.prepare("SELECT count(*) n FROM temp.sqlite_schema").get()!.n).toBe(0);
    }
    writer.exec("ROLLBACK");
    expect(applyXPageAdmissionMigration(e.database,input).applied).toBe(true);assertXPageAdmissionSchema(e.database);
    expect(state()).toEqual({foreignKeys,legacy,transaction:false});
    expect(applyXPageAdmissionMigration(e.database,input).applied).toBe(false);
    expect(state()).toEqual({foreignKeys,legacy,transaction:false});
  } finally {if(writer.isTransaction)writer.exec("ROLLBACK");writer.close();e.close();}
});

test("restores pragmas and rolls back when the closed-state check fails after BEGIN",async()=>{
  const e=await rssSourceEpochFixture();e.gateway.close();
  try {
    const before=sourceRegistrySchemaFingerprint(e.database);
    expect(()=>applyXPageAdmissionMigration(e.database,{applyEnabled:true,appliedAt:e.now().toISOString()})).toThrow("X_PAGE_ADMISSION_NOT_CLOSED");
    expect(e.database.isTransaction).toBe(false);
    expect(e.database.prepare("PRAGMA foreign_keys").get()!.foreign_keys).toBe(1);
    expect(e.database.prepare("PRAGMA legacy_alter_table").get()!.legacy_alter_table).toBe(0);
    expect(sourceRegistrySchemaFingerprint(e.database)).toBe(before);
  } finally {e.close();}
});
