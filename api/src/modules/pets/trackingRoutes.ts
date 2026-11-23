import { Router } from "express";
import type { Queryable } from "../../db/queryable.js";
import type { AuthStore } from "../auth/types.js";
import { createAuthenticateMiddleware, requirePrincipal } from "../auth/middleware/authenticate.js";
import { PetService } from "./service.js";

const distance = (a: number,b: number,c: number,d: number) => { const r=Math.PI/180, x=(c-a)*r, y=(d-b)*r; const h=Math.sin(x/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin(y/2)**2; return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h)); };
export function createTrackingRouter(db: Queryable, service: PetService, auth: AuthStore, secret: Uint8Array): Router {
 const router=Router(); router.use(createAuthenticateMiddleware(auth,secret));
 const owned=async (req: any, res: any) => { const id=req.params.petId; if(!/^[0-9a-f-]{36}$/i.test(id)) {res.status(400).json({error:{message:"ID de mascota inválido"}});return false;} try {const pet=await service.getById(requirePrincipal(req).userId,id);if(!pet){res.status(404).json({error:{message:"Mascota no encontrada"}});return false;}return true;}catch{res.status(404).json({error:{message:"Mascota no encontrada"}});return false;} };
 router.get('/:petId',async(req,res,next)=>{try{if(!await owned(req,res))return;const result=await db.query('SELECT device_id,safe_radius_m,home_lat,home_lon FROM pet_trackers WHERE pet_id=$1',[req.params.petId]); const config=result.rows[0];if(!config){res.json({configured:false});return;}
 const url=process.env.TRACCAR_URL?.replace(/\/$/,'');const token=process.env.TRACCAR_TOKEN;if(!url||!token){res.json({configured:true,config,available:false,reason:'Servidor Traccar sin configurar'});return;}
 const upstream=await fetch(`${url}/api/positions?deviceId=${config.device_id}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(9000)});if(!upstream.ok)throw new Error(`Traccar HTTP ${upstream.status}`);const data=await upstream.json() as Array<any>;const point=data[0];if(!point){res.json({configured:true,config,available:false,reason:'Sin posiciones recibidas'});return;}
 const lat=Number(point.latitude),lon=Number(point.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw new Error('Coordenadas inválidas');const home=config.home_lat==null?null:distance(Number(config.home_lat),Number(config.home_lon),lat,lon);res.json({configured:true,config,available:true,position:{latitude:lat,longitude:lon,fixTime:point.fixTime,accuracy:point.accuracy??null},distanceFromHomeM:home,outsideSafeZone:home===null?null:home>Number(config.safe_radius_m)});
 }catch(e){next(e)}});
 router.put('/:petId',async(req,res,next)=>{try{if(!await owned(req,res))return;const {deviceId,safeRadiusM=1000,homeLat=null,homeLon=null}=req.body??{};if(!Number.isSafeInteger(deviceId)||deviceId<=0||!Number.isInteger(safeRadiusM)||safeRadiusM<100||safeRadiusM>1000||((homeLat===null)!==(homeLon===null))||(homeLat!==null&&(!Number.isFinite(homeLat)||Math.abs(homeLat)>90||!Number.isFinite(homeLon)||Math.abs(homeLon)>180))){res.status(400).json({error:{message:'Datos del rastreador inválidos'}});return;}await db.query(`INSERT INTO pet_trackers(pet_id,device_id,safe_radius_m,home_lat,home_lon) VALUES($1,$2,$3,$4,$5) ON CONFLICT(pet_id) DO UPDATE SET device_id=$2,safe_radius_m=$3,home_lat=$4,home_lon=$5`,[req.params.petId,deviceId,safeRadiusM,homeLat,homeLon]);res.json({configured:true});}catch(e){next(e)}});
 router.delete('/:petId',async(req,res,next)=>{try{if(!await owned(req,res))return;await db.query('DELETE FROM pet_trackers WHERE pet_id=$1',[req.params.petId]);res.sendStatus(204)}catch(e){next(e)}});
 return router;
}
