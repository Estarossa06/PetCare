import { useLocalSearchParams } from 'expo-router';
import TrackingScreen from '../../../src/features/pets/screens/TrackingScreen';
export default function TrackingRoute(){const {id}=useLocalSearchParams<{id:string}>();return <TrackingScreen petId={id}/>;}
